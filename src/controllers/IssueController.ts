import { NextFunction, Request, Response } from "express";
import { IssueService } from "../services/IssueService";

export class IssueController {
  
  async getAllIssues(request: Request, response: Response) {
    const issueService = new IssueService();
    return response.send(await issueService.findAll(request));
  }

  async updateIssueById(request: Request, response: Response) {
    const issueService = new IssueService();
    return response.send(await issueService.update(request));
  }

  async exportIssueToExcel(request: Request, response: Response) {
    const issueService = new IssueService();
    return response.send(await issueService.exportIssueToExcel(request));
  }
}
