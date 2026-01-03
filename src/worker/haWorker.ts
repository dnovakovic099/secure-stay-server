import dotenv from "dotenv";
dotenv.config();
import { ExpenseService } from "../services/ExpenseService";
import { ResolutionService } from "../services/ResolutionService";
import logger from "../utils/logger.utils";
import connection from "../utils/redisConnection";
import { Worker } from "bullmq";
import { appDatabase } from "../utils/database.util";
import { categoryIds, resolutionCategoryMappings } from "../constant";
import { format } from "date-fns/format";
import { HostAwayClient } from "../client/HostAwayClient";
import { Resolution } from "../entity/Resolution";
import { FileInfo } from "../entity/FileInfo";
import { initRootFolder, getOrCreateFolder, drive, uploadToDrive } from "../utils/drive";
import fs from "fs";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { LiveIssue, LiveIssueStatus } from "../entity/LiveIssue";
import { LiveIssueUpdates } from "../entity/LiveIssueUpdates";

(async () => {

    process.on('uncaughtException', (err) => {
        logger.error('Worker Uncaught Exception:', err);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        logger.error('Worker Unhandled Rejection:', reason);
    });

    if (!appDatabase.isInitialized) {
        await appDatabase.initialize();
    }

    // 🔧 Worker 1: ha-expense-queue
    const expenseWorker = new Worker('ha-expense-queue', async job => {
        try {
            const { payload, userId, expenseId } = job.data;
            const expenseService = new ExpenseService();
            const result = await expenseService.updateHostawayExpense(payload, userId, expenseId);
            if (!result) {
                logger.error(`Hostaway sync failed for expenseId ${expenseId}`);
                throw new Error('Hostaway sync failed');
            }
            logger.info(`Hostaway sync successful for expenseId ${expenseId}`);
        } catch (error) {
            logger.error(`Error processing expense job ${job.id}:`, error);
            throw error;
        }
    }, {
        connection
    });

    // 🔧 Worker 2: ha-resolution-queue
    const resolutionWorker = new Worker('ha-resolution-queue', async job => {
        try {
            const { resolution } = job.data;
            const categories = JSON.stringify([categoryIds.Resolutions]);

            const obj = {
                listingMapId: String(resolution.listingMapId),
                expenseDate: format(new Date(), 'yyyy-MM-dd'),
                concept: `${resolution.creationSource && resolution.creationSource == "csv_upload" ? `Airbnb ${resolution.type}` : `${resolution.category}`}: ${resolution.guestName}`,
                amount: resolution.amount,
                categories: JSON.parse(categories),
                reservationId: resolution.reservationId
            };
            const clientId = process.env.HOST_AWAY_CLIENT_ID;
            const clientSecret = process.env.HOST_AWAY_CLIENT_SECRET;

            const hostAwayClient = new HostAwayClient();
            const hostawayExpense = await hostAwayClient.createExpense(obj, { clientId, clientSecret });

            if (hostawayExpense) {
                const expenseId = hostawayExpense.id;
                resolution.ha_id = expenseId;
                await appDatabase.getRepository(Resolution).save(resolution);
            } else {
                logger.error(`[resolution] Failed to create expense/extras in hostaway for the resolution id ${resolution.id}`);
                throw new Error(`Failed to create expense/extras in hostaway for the resolution id ${resolution.id}`);
            }

        } catch (error) {
            logger.error(`Error processing resolution job ${job.id}:`, error);
            throw error;
        }
    }, {
        connection
    });

    // 🔧 Worker 3: ha-resolution-update-queue
    const updateResolutionWorker = new Worker('ha-resolution-update-queue', async job => {
        try {
            const { resolution } = job.data;

            const amount = resolution.amountToPayout ? resolution.amountToPayout : resolution.amount;

            const hostAwayClient = new HostAwayClient();
            const clientId = process.env.HOST_AWAY_CLIENT_ID;
            const clientSecret = process.env.HOST_AWAY_CLIENT_SECRET;

            const expense = await hostAwayClient.getExpense(resolution.ha_id, clientId, clientSecret);

            const categories = JSON.stringify([categoryIds.Resolutions]);
            const obj = {
                listingMapId: String(resolution.listingMapId),
                expenseDate: expense?.expenseDate,
                concept: `${resolution.description ? `Airbnb ${resolution.description}` : `${resolution.category}`}: ${resolution.guestName}`,
                amount: amount,
                categories: JSON.parse(categories),
                reservationId: resolution.reservationId
            };

            const hostawayExpense = await hostAwayClient.updateExpense(obj, { clientId, clientSecret }, resolution.ha_id);
            if (!hostawayExpense) {
                logger.error(`[resolution] Failed to update expense/extras in hostaway for the resolution id ${resolution.id}`);
                throw new Error(`Failed to update expense/extras in hostaway for the resolution id ${resolution.id}`);
            }

        } catch (error) {
            logger.error(`Error processing resolution job ${job.id}:`, error);
            throw error;
        }
    }, {
        connection
    });

    // 🔧 Worker 3: ha-resolution-update-queue
    const deleteResolutionWorker = new Worker('ha-resolution-delete-queue', async job => {
        try {
            const { resolution } = job.data;

            const hostAwayClient = new HostAwayClient();
            const clientId = process.env.HOST_AWAY_CLIENT_ID;
            const clientSecret = process.env.HOST_AWAY_CLIENT_SECRET;

            const hostawayExpense = await hostAwayClient.deleteExpense(resolution.ha_id, clientId, clientSecret);
            if (!hostawayExpense) {
                logger.error(`[resolution] Failed to delete expense/extras in hostaway for the resolution id ${resolution.id}`);
                throw new Error(`Failed to delete expense/extras in hostaway for the resolution id ${resolution.id}`);
            }

        } catch (error) {
            logger.error(`Error processing resolution job ${job.id}:`, error);
            throw error;
        }
    }, {
        connection
    });

    // 🔧 Worker 4: google-drive-file-upload
    const googleDriveFileUploadWorker = new Worker(
        "google-drive-file-upload",
        async job => {
            try {
                const fileInfo: FileInfo = job.data.entity;
                const fileRepo = appDatabase.getRepository(FileInfo);

                // 🔹 Check if local file exists first
                if (!fs.existsSync(fileInfo.localPath)) {
                    logger.warn(
                        `Local file not found for entityId ${fileInfo.entityId}: ${fileInfo.localPath}`
                    );

                    // mark record as missing instead of retrying forever
                    fileInfo.status = "failed";
                    await fileRepo.save(fileInfo);

                    return; // exit gracefully
                }

                const ROOT_FOLDER_ID = await initRootFolder();
                const SUB_FOLDER_ID = await getOrCreateFolder(
                    drive,
                    fileInfo.entityType,
                    ROOT_FOLDER_ID
                );

                const response = await uploadToDrive(
                    fileInfo.localPath,
                    fileInfo.fileName,
                    fileInfo.mimetype,
                    SUB_FOLDER_ID,
                    ROOT_FOLDER_ID
                );

                if (response && response.id) {
                    fileInfo.driveFileId = response.id;
                    fileInfo.webViewLink = response.webViewLink || "";
                    fileInfo.webContentLink = response.webContentLink || "";
                    fileInfo.status = "uploaded";
                    await fileRepo.save(fileInfo);

                    logger.info(`File uploaded successfully: ${JSON.stringify(fileInfo)}`);

                    // delete local file after upload
                    try {
                        fs.unlinkSync(fileInfo.localPath);
                        logger.info(`Deleted local file: ${fileInfo.localPath}`);
                    } catch (unlinkErr) {
                        logger.error(
                            `Failed to delete local file ${fileInfo.localPath}: ${unlinkErr.message}`
                        );
                    }
                } else {
                    logger.error(
                        `Failed to upload file to Google Drive for ${JSON.stringify(fileInfo)}`
                    );
                    fileInfo.status = "failed";
                    await fileRepo.save(fileInfo);
                }
            } catch (error) {
                logger.error(`Error uploading file ${job.id}:`, error);
                throw error; // job may retry depending on queue config
            }
        },
        {
            connection
        }
    );

    // 🔧 Worker 5: create-expense-from-resolution
    const createExpenseFromResolutionWorker = new Worker('create-expense-from-resolution', async job => {
        try {
            const resolution: Resolution = job.data.resolution;
            const category = resolutionCategoryMappings.find(cat => cat.name === resolution.category)?.value;
            const categories = category ? JSON.stringify([category]) : JSON.stringify([categoryIds.Resolutions]);

            const expenseRepo = appDatabase.getRepository(ExpenseEntity);
            const newExpense = expenseRepo.create({
                listingMapId: resolution.listingMapId,
                expenseDate: resolution.claimDate,
                concept: resolution.type ? `${resolution.type} : ${resolution.guestName}` : `${resolution.guestName}`,
                amount: resolution.amountToPayout ? resolution.amountToPayout : resolution.amount,
                isDeleted: 0,
                categories: categories,
                contractorName: "",
                findings: resolution.description ? resolution.description : null,
                userId: "system",
                fileNames: "",
                status: ExpenseStatus.NA,
                reservationId: String(resolution.reservationId),
                guestName: resolution.guestName,
                resolutionId: resolution.id
            });
            await expenseRepo.save(newExpense);

            logger.info(`Expense created successfully for resolutionId ${resolution.id}`);
        } catch (error) {
            logger.error(`Error processing expense job ${job.id}:`, error);
            throw error;
        }
    }, {
        connection
    });

    // 🔧 Worker 6: update-expense-from-resolution
    const updateExpenseFromResolutionWorker = new Worker('update-expense-from-resolution', async job => {
        try {
            const resolution: Resolution = job.data.resolution;

            const category = resolutionCategoryMappings.find(cat => cat.name === resolution.category)?.value;
            const categories = category ? JSON.stringify([category]) : JSON.stringify([categoryIds.Resolutions]);

            const expenseRepo = appDatabase.getRepository(ExpenseEntity);
            const expense = await expenseRepo.findOneBy({ resolutionId: resolution.id });
            if (!expense) {
                logger.error(`Expense not found for resolutionId ${resolution.id}`);
                return;
            }

            expense.listingMapId = resolution.listingMapId;
            expense.expenseDate = resolution.claimDate;
            expense.concept = resolution.type ? `${resolution.type} : ${resolution.guestName}` : `${resolution.guestName}`;
            expense.amount = resolution.amountToPayout ? resolution.amountToPayout : resolution.amount;
            expense.categories = categories;
            expense.findings = resolution.description ? resolution.description : null;
            expense.reservationId = String(resolution.reservationId);
            expense.guestName = resolution.guestName;
            expense.isDeleted = resolution.deletedAt ? 1 : 0;

            await expenseRepo.save(expense);

            logger.info(`Expense updated successfully for resolutionId ${resolution.id}`);
        } catch (error) {
            logger.error(`Error processing expense job ${job.id}:`, error);
            throw error;
        }
    }, {
        connection
    });

    // 🔧 Worker 7: update-resolution-from-expense
    const updateResolutionFromExpense = new Worker('update-resolution-from-expense', async job => {
        try {
            const expense: ExpenseEntity = job.data.expense;

            const incomingCategories = JSON.parse(expense.categories);
            const category = resolutionCategoryMappings.find(cat => cat.value === incomingCategories[0])?.name;

            const resolutionRepo = appDatabase.getRepository(Resolution);
            const resolution = await resolutionRepo.findOne({ where: { id: expense.resolutionId } });
            if (!resolution) {
                logger.error(`Resolution not found for expenseId ${expense.id}`);
                return;
            }
            
            resolution.listingMapId = expense.listingMapId;
            resolution.claimDate = expense.expenseDate;
            resolution.amountToPayout = expense.amount;
            resolution.deletedAt = expense.isDeleted === 1 ? new Date() : null;
            resolution.category = category;

            await resolutionRepo.save(resolution);

            logger.info(`Resolution updated successfully for expenseId ${expense.id}`);
        } catch (error) {
            logger.error(`Error processing resolution job ${job.id}:`, error);
            throw error;
        }
    }, {
        connection
    });

    // 🔧 Worker 8: create-live-issue-from-resolution
    const createLiveIssueFromResolutionWorker = new Worker('create-live-issue-from-resolution', async job => {
        try {
            const resolution: Resolution = job.data.resolution;

            // Only create live issue for negative amounts (expenses/losses)
            const amount = resolution.amountToPayout ?? resolution.amount;
            if (Number(amount) >= 0) {
                logger.info(`Skipping live issue creation for resolutionId ${resolution.id} - amount is positive (${amount})`);
                return;
            }

            const liveIssueRepo = appDatabase.getRepository(LiveIssue);

            // Check if live issue already exists for this resolution
            const existingLiveIssue = await liveIssueRepo.findOne({
                where: { resolutionId: resolution.id }
            });

            if (existingLiveIssue) {
                logger.info(`Live issue already exists for resolutionId ${resolution.id}, skipping creation`);
                return;
            }

            const newLiveIssue = liveIssueRepo.create({
                status: LiveIssueStatus.NEW,
                propertyId: resolution.listingMapId,
                guestName: resolution.guestName,
                reservationId: resolution.reservationId,
                resolutionId: resolution.id,
                summary: `Resolution: ${resolution.category}${resolution.description ? ` - ${resolution.description}` : ''}`,
                createdBy: 'system'
            });

            await liveIssueRepo.save(newLiveIssue);
            logger.info(`Live issue created successfully for resolutionId ${resolution.id}`);
        } catch (error) {
            logger.error(`Error processing live issue job ${job.id}:`, error);
            throw error;
        }
    }, {
        connection
    });

    // 🔧 Worker 9: update-live-issue-from-resolution
    const updateLiveIssueFromResolutionWorker = new Worker('update-live-issue-from-resolution', async job => {
        try {
            const resolution: Resolution = job.data.resolution;

            const liveIssueRepo = appDatabase.getRepository(LiveIssue);
            const liveIssueUpdatesRepo = appDatabase.getRepository(LiveIssueUpdates);

            const amount = resolution.amountToPayout ?? resolution.amount;
            const isNegativeAmount = Number(amount) < 0;

            // Query including soft-deleted records to handle restore scenarios
            const liveIssue = await liveIssueRepo
                .createQueryBuilder('liveIssue')
                .withDeleted()
                .where('liveIssue.resolutionId = :resolutionId', { resolutionId: resolution.id })
                .getOne();

            // Case 1: No live issue exists at all (not even soft-deleted)
            if (!liveIssue) {
                // If amount is now negative, create a new live issue
                if (isNegativeAmount) {
                    const newLiveIssue = liveIssueRepo.create({
                        status: LiveIssueStatus.NEW,
                        propertyId: resolution.listingMapId,
                        guestName: resolution.guestName,
                        reservationId: resolution.reservationId,
                        resolutionId: resolution.id,
                        summary: `Resolution: ${resolution.category}${resolution.description ? ` - ${resolution.description}` : ''}`,
                        createdBy: 'system'
                    });
                    await liveIssueRepo.save(newLiveIssue);
                    logger.info(`Live issue created on update for resolutionId ${resolution.id} (amount changed to negative)`);
                } else {
                    logger.info(`No live issue exists and amount is positive for resolutionId ${resolution.id}, skipping`);
                }
                return;
            }

            // Case 2: Live issue exists (soft-deleted) and amount is now negative - restore it
            if (liveIssue.deletedAt && isNegativeAmount) {
                liveIssue.deletedAt = null;
                liveIssue.deletedBy = null;
                liveIssue.propertyId = resolution.listingMapId;
                liveIssue.guestName = resolution.guestName;
                liveIssue.reservationId = resolution.reservationId;
                liveIssue.summary = `Resolution: ${resolution.category}${resolution.description ? ` - ${resolution.description}` : ''}`;
                liveIssue.updatedBy = 'system';
                await liveIssueRepo.save(liveIssue);

                // Create an update log entry explaining the restoration
                const updateLog = liveIssueUpdatesRepo.create({
                    updates: `Live issue restored: Resolution amount changed back to negative (${amount})`,
                    liveIssue: liveIssue,
                    createdBy: 'system'
                });
                await liveIssueUpdatesRepo.save(updateLog);

                logger.info(`Live issue restored for resolutionId ${resolution.id} - amount changed back to negative (${amount})`);
                return;
            }

            // Case 3: Live issue exists (not deleted) and amount changed to positive - soft delete
            if (!isNegativeAmount) {
                liveIssue.deletedAt = new Date();
                liveIssue.deletedBy = 'system';
                await liveIssueRepo.save(liveIssue);

                // Create an update log entry explaining the deletion
                const updateLog = liveIssueUpdatesRepo.create({
                    updates: `Live issue closed: Resolution amount changed to positive (${amount})`,
                    liveIssue: liveIssue,
                    createdBy: 'system'
                });
                await liveIssueUpdatesRepo.save(updateLog);

                logger.info(`Live issue soft-deleted for resolutionId ${resolution.id} - amount changed to positive (${amount})`);
                return;
            }

            // Case 3: Live issue exists and amount is still negative - update normally
            liveIssue.propertyId = resolution.listingMapId;
            liveIssue.guestName = resolution.guestName;
            liveIssue.reservationId = resolution.reservationId;
            liveIssue.summary = `Resolution: ${resolution.category}${resolution.description ? ` - ${resolution.description}` : ''}`;
            liveIssue.updatedBy = 'system';

            // Mark as deleted if resolution is soft-deleted
            if (resolution.deletedAt) {
                liveIssue.deletedAt = new Date();
                liveIssue.deletedBy = 'system';
            }

            await liveIssueRepo.save(liveIssue);

            // Create an update log entry
            const updateLog = liveIssueUpdatesRepo.create({
                updates: `Resolution updated: Amount ${amount}, Category: ${resolution.category}`,
                liveIssue: liveIssue,
                createdBy: 'system'
            });
            await liveIssueUpdatesRepo.save(updateLog);

            logger.info(`Live issue updated successfully for resolutionId ${resolution.id}`);
        } catch (error) {
            logger.error(`Error processing live issue job ${job.id}:`, error);
            throw error;
        }
    }, {
        connection
    });



    // Listeners for both workers
    expenseWorker.on('completed', job => {
        logger.info(`✅ Expense Job ${job.id} completed for expenseId ${job.data.expenseId}`);
    });

    expenseWorker.on('failed', (job, err) => {
        logger.error(`❌ Expense Job ${job.id} failed for expenseId ${job.data.expenseId}: ${err.message}`);
    });

    resolutionWorker.on('completed', job => {
        logger.info(`✅ Resolution Job ${job.id} completed for resolutionId ${job.data.resolution.id}`);
    });

    resolutionWorker.on('failed', (job, err) => {
        logger.error(`❌ Resolution Job ${job.id} failed for resolutionId ${job.data.resolution.id}: ${err.message}`);
    });


    updateResolutionWorker.on('completed', job => {
        logger.info(`✅ Resolution Job ${job.id} completed for resolutionId ${job.data.resolution.id}`);
    });

    updateResolutionWorker.on('failed', (job, err) => {
        logger.error(`❌ Resolution Job ${job.id} failed for resolutionId ${job.data.resolution.id}: ${err.message}`);
    });

    deleteResolutionWorker.on('completed', job => {
        logger.info(`✅ Resolution Job ${job.id} completed for resolutionId ${job.data.resolution.id}`);
    });

    deleteResolutionWorker.on('failed', (job, err) => {
        logger.error(`❌ Resolution Job ${job.id} failed for resolutionId ${job.data.resolution.id}: ${err.message}`);
    });

    googleDriveFileUploadWorker.on('completed', job => {
        logger.info(`✅ File upload Job ${job.id} completed for fileId ${job.data.entity.id}`);
    });

    googleDriveFileUploadWorker.on('failed', (job, err) => {
        logger.error(`❌ File upload Job ${job.id} failed for fileId ${job.data.entity.id}: ${err.message}`);
    });

    createExpenseFromResolutionWorker.on('completed', job => {
        logger.info(`✅ Create Expense Job ${job.id} completed for resolutionId ${job.data.resolution.id}`);
    });

    createExpenseFromResolutionWorker.on('failed', (job, err) => {
        logger.error(`❌ Create Expense Job ${job.id} failed for resolutionId ${job.data.resolution.id}: ${err.message}`);
    });

    updateExpenseFromResolutionWorker.on('completed', job => {
        logger.info(`✅ Update Expense Job ${job.id} completed for resolutionId ${job.data.resolution.id}`);
    });

    updateExpenseFromResolutionWorker.on('failed', (job, err) => {
        logger.error(`❌ Update Expense Job ${job.id} failed for resolutionId ${job.data.resolution.id}: ${err.message}`);
    });

    updateResolutionFromExpense.on('completed', job => {
        logger.info(`✅ Update Resolution Job ${job.id} completed for expenseId ${job.data.expense.id}`);
    });

    updateResolutionFromExpense.on('failed', (job, err) => {
        logger.error(`❌ Update Resolution Job ${job.id} failed for expenseId ${job.data.expense.id}: ${err.message}`);
    });

    createLiveIssueFromResolutionWorker.on('completed', job => {
        logger.info(`✅ Create Live Issue Job ${job.id} completed for resolutionId ${job.data.resolution.id}`);
    });

    createLiveIssueFromResolutionWorker.on('failed', (job, err) => {
        logger.error(`❌ Create Live Issue Job ${job.id} failed for resolutionId ${job.data.resolution.id}: ${err.message}`);
    });

    updateLiveIssueFromResolutionWorker.on('completed', job => {
        logger.info(`✅ Update Live Issue Job ${job.id} completed for resolutionId ${job.data.resolution.id}`);
    });

    updateLiveIssueFromResolutionWorker.on('failed', (job, err) => {
        logger.error(`❌ Update Live Issue Job ${job.id} failed for resolutionId ${job.data.resolution.id}: ${err.message}`);
    });

})();
