import { appDatabase } from "../utils/database.util";
import { Request } from "express";
import { GuideBook } from "../entity/GuideBook";
import path from "path";
import fs from "fs";

export class GuideBookService {
  private guideBookRepository = appDatabase.getRepository(GuideBook);

  async PostGuides(request: Request) {
    const { title, description, listingId } = request.body;

    console.log(request.file.path);

    const newGuideBook = new GuideBook();
    newGuideBook.listing = Number(listingId);
    newGuideBook.title = title;
    newGuideBook.description = description;
    newGuideBook.photo = request.file.path;

    return await this.guideBookRepository.save(newGuideBook);
  }

  async UpdateGuides(request: Request) {
    const id = parseInt(request.params.id, 10);
    const { title, description, listingId } = request.body;

    const data = await this.guideBookRepository.findOne({ where: { id: id } });

    if (!data) {
      return {
        status: true,
        message: "No guide data found!!!",
      };
    }

    const imagePath = path.join(__dirname, "..", "..", data.photo);

    fs.unlink(imagePath, (err) => {
      if (err) {
        console.log(err);
      } else {
        console.log("Image deleted successfully");
      }
    });

    data.listing = Number(listingId);
    data.title = title;
    data.description = description;
    if (request.file.path) {
      data.photo = request.file.path;
    }

    return await this.guideBookRepository.save(data);
  }

  async DeleteGuides(request: Request) {
    const id = parseInt(request.params.id, 10);

    const data = await this.guideBookRepository.findOne({ where: { id: id } });

    if (!data) {
      return {
        status: true,
        message: "No guide data found or already deleted.",
      };
    }

    const imagePath = path.join(__dirname, "..", "..", data.photo);
    console.log(imagePath);

    fs.unlink(imagePath, (err) => {
      if (err) {
        console.log(err);
      } else {
        console.log("Image deleted successfully");
      }
    });

    const g = await this.guideBookRepository.remove(data);
    console.log(g);
    return { status: true, message: "data deleted successfully" };
  }
}
