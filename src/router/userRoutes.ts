import { UsersController } from "../controllers/UsersController";

export const UserRoutes = () => {
  const userController = new UsersController();
  return [
    {
      path: "/user/createNewUser",
      method: "post",
      action: userController.createNewUser,
      file: true,
      rawJson: false,
    },
    {
      path: "/user/updateUser",
      method: "post",
      action: userController.updateUser,
      file: true,
      rawJson: false,
    },
    {
      path: "/user/deleteUser",
      method: "delete",
      action: userController.deleteUser,
      file: false,
      rawJson: false,
    },
    {
      path: "/user/getSingleUser",
      method: "get",
      action: userController.getSingleUser,
      file: false,
      rawJson: false,
    },
    {
      path: "/user/getUserList",
      method: "get",
      action: userController.getUserList,
      file: false,
      rawJson: false,
    },
    {
      path: "/user/deleteMultipleUser",
      method: "post",
      action: userController.deleteMultipleUser,
      file: false,
      rawJson: false,
    },
    {
      path: "/user/updateUserStatus",
      method: "put",
      action: userController.updateUserStatus,
      file: false,
      rawJson: false,
    },
    {
      path: "/user/updateMultipleUserStatus",
      method: "post",
      action: userController.updateMultipleUserStatus,
      file: false,
      rawJson: false,
    },
  ];
};
