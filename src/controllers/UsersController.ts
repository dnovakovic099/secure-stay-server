import { Request, Response } from "express";
import { UsersService } from "../services/UsersService";

export class UsersController {
  async createUser(request: Request, response: Response) {
    const usersService = new UsersService();
    return response.send(await usersService.createUser(request, response));
  }

  async createNewUser(request: Request, response: Response) {
    const createUserService = new UsersService();
    return response.send(await createUserService.createNewUser(request));
  }

  async updateUser(request: Request, response: Response) {
    const updateService = new UsersService();
    return response.send(await updateService.updateUser(request));
  }

  async deleteUser(request: Request, response: Response) {
    const deleteService = new UsersService();
    return response.send(await deleteService.deleteUser(request));
  }

  async getSingleUser(request: Request, response: Response) {
    const singleUserService = new UsersService();
    return response.send(await singleUserService.getSingleUser(request));
  }

  async getUserList(request: Request, response: Response) {
    const userListService = new UsersService();
    return response.send(await userListService.getUserList(request));
  }

  async deleteMultipleUser(request: Request, response: Response) {
    const deleteMultipleUserService = new UsersService();
    return response.send(
      await deleteMultipleUserService.deleteMultipleUser(request)
    );
  }

  async updateUserStatus(request: Request, response: Response) {
    const updateUserStatusService = new UsersService();
    return response.send(
      await updateUserStatusService.updateUserStatus(request)
    );
  }

  async updateMultipleUserStatus(request: Request, response: Response) {
    const multipleUserStatusService = new UsersService();
    return response.send(
      await multipleUserStatusService.updateMultipleUserStatus(request)
    );
  }
}
