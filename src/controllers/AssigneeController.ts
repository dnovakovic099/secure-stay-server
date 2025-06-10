import { Request, Response } from "express";
import { AssigneeService } from "../services/AssigneeService";

interface CustomRequest extends Request {
    user?: any;
}

export class AssigneeController {
    async saveAssigneeInfo(request: CustomRequest, response: Response) {
        const assigneeService = new AssigneeService();;
        return response.send(await assigneeService.saveAssigneeInfo(request));
    }

    async getAssignees(request: CustomRequest, response: Response) {
        const assigneeService = new AssigneeService();
        return response.send(await assigneeService.getAssignees());
    }
}
