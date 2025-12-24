import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger.utils';

interface AsanaTaskPayload {
    name: string;
    notes?: string;
    projects: string[];
    custom_fields?: Record<string, string | number | { date: string; }>;
}

interface AsanaTask {
    gid: string;
    name: string;
    resource_type: string;
}

interface AsanaResponse<T> {
    data: T;
}

export class AsanaClient {
    private client: AxiosInstance;
    private projectId: string;
    private sectionId: string;

    constructor() {
        const pat = process.env.ASANA_PAT;
        if (!pat) {
            throw new Error('ASANA_PAT environment variable is required');
        }

        this.projectId = process.env.ASANA_PROJECT_ID || '';
        this.sectionId = process.env.ASANA_SECTION_ID || '';

        this.client = axios.create({
            baseURL: 'https://app.asana.com/api/1.0',
            headers: {
                'Authorization': `Bearer ${pat}`,
                'Content-Type': 'application/json',
            },
        });
    }

    /**
     * Create a task in Asana with custom fields and notes
     */
    async createTask(payload: {
        name: string;
        notes?: string;
        customFields?: Record<string, string | number | { date: string; }>;
    }): Promise<AsanaTask> {
        const requestBody: { data: AsanaTaskPayload; } = {
            data: {
                name: payload.name,
                projects: [this.projectId],
            },
        };

        if (payload.notes) {
            requestBody.data.notes = payload.notes;
        }

        if (payload.customFields && Object.keys(payload.customFields).length > 0) {
            requestBody.data.custom_fields = payload.customFields;
        }

        try {
            logger.info(`Creating Asana task: ${payload.name}`);
            logger.debug(`Asana request body: ${JSON.stringify(requestBody)}`);
            const response = await this.client.post<AsanaResponse<AsanaTask>>('/tasks', requestBody);
            return response.data.data;
        } catch (error: any) {
            // Log detailed error from Asana API
            if (error.response) {
                logger.error(`Asana API error: ${JSON.stringify(error.response.data)}`);
                logger.error(`Asana request that failed: ${JSON.stringify(requestBody)}`);
            }
            throw error;
        }
    }

    /**
     * Add a task to a specific section
     */
    async addTaskToSection(taskGid: string, sectionGid?: string): Promise<void> {
        const targetSection = sectionGid || this.sectionId;
        if (!targetSection) {
            logger.warn('No section ID provided, task will remain in default section');
            return;
        }

        await this.client.post(`/sections/${targetSection}/addTask`, {
            data: {
                task: taskGid,
            },
        });
    }

    /**
     * Create a task and add it to the configured section
     */
    async createTaskInSection(payload: {
        name: string;
        notes?: string;
        customFields?: Record<string, string | number | { date: string; }>;
    }): Promise<AsanaTask> {
        const task = await this.createTask(payload);
        await this.addTaskToSection(task.gid);
        return task;
    }
}
