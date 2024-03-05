// src/router/AutomatedMessageRoutes.ts

import { AutomatedMessageController } from "../controllers/AutoMessageController";
import { Request, Response } from "express";

export const AutomatedMessageRoutes = () => {
  const automatedMessageController = new AutomatedMessageController();

  return [
    {
      path: "/automated-messages",
      method: "post",
      action: automatedMessageController.createAutomatedMessage,
      file: false,
      rawJson: true,
    },
    {
      path: "/automated-messages",
      method: "get",
      action: automatedMessageController.getAllAutomatedMessages,
      file: false,
      rawJson: true,
    },
    {
      path: "/automated-messages/:id",
      method: "get",
      action: automatedMessageController.getAutomatedMessageById,
      file: false,
      rawJson: true,
    },
    {
      path: "/automated-messages/:id",
      method: "put",
      action: automatedMessageController.updateAutomatedMessage,
      file: false,
      rawJson: true,
    },
    {
      path: "/automated-messages/:id",
      method: "delete",
      action: automatedMessageController.deleteAutomatedMessage,
      file: false,
      rawJson: false,
    },
  ];
};
