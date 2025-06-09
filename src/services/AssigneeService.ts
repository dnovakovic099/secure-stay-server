import { appDatabase } from "../utils/database.util";
import { Request } from "express";
import { AssigneeEntity } from "../entity/AssigneeInfo";

export class AssigneeService {
    private assigneeInfoRepo = appDatabase.getRepository(AssigneeEntity);

    async saveAssigneeInfo(request: Request) {
        const { assigneeName, assigneeNumber } = request.body;

        const newAssignee = new AssigneeEntity();
        newAssignee.assigneeName = assigneeName;

        const assignee = await this.assigneeInfoRepo.save(newAssignee);
        return assignee;
    }

    async getAssignees() {
        return await this.assigneeInfoRepo.find();
    }

}
