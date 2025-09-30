import { EntitySubscriberInterface, EventSubscriber, InsertEvent } from 'typeorm';
import { FileInfo } from '../entity/FileInfo';
import { googleDriveFileUpload } from '../queue/fileUploadQueue';


@EventSubscriber()
export class FileInfoSubscriber
    implements EntitySubscriberInterface<FileInfo> {

    listenTo() {
        return FileInfo;
    }

    async afterInsert(event: InsertEvent<FileInfo>) {
        const { entity, manager } = event;
        googleDriveFileUpload.add('file-upload', { entity });
    }

}
