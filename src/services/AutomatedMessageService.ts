import { appDatabase } from "../utils/database.util";
import { Request } from "express";
import { AutomatedMessage } from "../entity/AutomatedMessage";

export class AutomatedMessageService {
  private automatedMessageRepository =
    appDatabase.getRepository(AutomatedMessage);

  async createAutomatedMessage(request: Request) {
    const { messageType, messageText } = request.body;
    console.log(request.body);

    const newAutomatedMessage = new AutomatedMessage();
    newAutomatedMessage.messageType = messageType;
    newAutomatedMessage.messageText = messageText;

    return await this.automatedMessageRepository.save(newAutomatedMessage);
  }

  async getAllAutomatedMessages() {
    return await this.automatedMessageRepository.find();
  }

  async getAutomatedMessageById(request: Request) {
    const id = parseInt(request.params.id, 10);
    return await this.automatedMessageRepository.findOne({ where: { id: id } });
  }

  async updateAutomatedMessage(request: Request) {
    const id = parseInt(request.params.id, 10);
    const { messageType, messageText } = request.body;

    const existingMessage = await this.automatedMessageRepository.findOne({
      where: { id: id },
    });

    if (!existingMessage) {
      return {
        status: false,
        message: "Automated message not found!",
      };
    }

    existingMessage.messageType = messageType;
    existingMessage.messageText = messageText;

    return await this.automatedMessageRepository.save(existingMessage);
  }

  async deleteAutomatedMessage(request: Request) {
    const id = parseInt(request.params.id, 10);

    const existingMessage = await this.automatedMessageRepository.findOne({
      where: { id: id },
    });

    if (!existingMessage) {
      return {
        status: false,
        message: "Automated message not found or already deleted.",
      };
    }

    await this.automatedMessageRepository.remove(existingMessage);

    return { status: true, message: "Automated message deleted successfully." };
  }
}
