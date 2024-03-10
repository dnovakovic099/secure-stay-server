import express, { Express, Request, Response } from "express";
import { AppRoutes } from "../router/routes";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";

export function createRouting(app: Express) {
  //hided for test the seam api call

  // const allowedOrigins = ['http://localhost:5173','http://0.0.0.0:5173',
  // 'http://217.196.51.223:5173'];

  // const corsOptions = {
  //     origin: function (origin, callback) {
  //         if (!origin || allowedOrigins.includes(origin)) {
  //             callback(null, true);
  //         } else {
  //             callback(new Error('Not allowed by CORS'));
  //         }
  //     },
  //     methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  //     credentials: true,
  //     optionsSuccessStatus: 204,
  // };
  // app.use(cors(corsOptions));

  //added cors error hadling for localhost seam api call
  app.options("*", cors());
  app.use(
    cors({
      origin: "*",
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
      preflightContinue: false,
      optionsSuccessStatus: 204,
    })
  );

  AppRoutes().forEach((route) => {
    if (route.file) {
      try {
        let fileLocation = "uploads";
        var storage = multer.diskStorage({
          destination: function (req, file, cb) {
            // cb(null, "uploads");
            fs.mkdir("uploads", (err) => {
              cb(null, "uploads");
            });
          },
          filename: function (req, file, cb) {
            let name = `${
              file.originalname.split(" ").join("-").split(".")[0]
            }-${Date.now()}`;

            const ext = file.mimetype.split("/")[1];
            const filename = [name, ext].join(".");
            cb(null, filename);
          },
        });

        const upload = multer({ storage: storage });

        app[route.method](
          route.path,
          upload.single("photo"),
          (request: Request, response: Response, next: Function) => {
            route
              .action(request, response, fileLocation)
              .then(() => next)
              .catch((err) => next(err));
          }
        );
      } catch (err) {}
    } else {
      if (route.rawJson) {
        app[route.method](
          route.path,
          express.raw({ type: "application/json" }),
          (request: Request, response: Response, next: Function) => {
            route
              .action(request, response, "")
              .then(() => next)
              .catch((err) => next(err));
          }
        );
      } else {
        app[route.method](
          route.path,
          express.json({ limit: "50mb" }),
          (request: Request, response: Response, next: Function) => {
            route
              .action(request, response, "")
              .then(() => next)
              .catch((err) => next(err));
          }
        );
      }
    }
  });
}
