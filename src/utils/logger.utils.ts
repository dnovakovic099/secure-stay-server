
import { createLogger, format, Logger, transports } from "winston";
const { combine, timestamp, printf } = format;
import { getFormattedUTCDateTime } from "../helpers/date";
import DailyRotateFile from "winston-daily-rotate-file";

const myFormat = printf(({ level, message, timestamp }) => {
    return `${getFormattedUTCDateTime()} [${level}] : ${message}`;
});

let logger: Logger;

if (process.env.NODE_ENV === 'production') {
    const dailyRotateFileTransport = new DailyRotateFile({
        filename: './logs/app-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '7d'
    });

    logger = createLogger({
        level: 'info',
        format: combine(
            timestamp(),
            myFormat,
        ),
        transports: [
            dailyRotateFileTransport
        ],
        exceptionHandlers: [
            dailyRotateFileTransport
        ]
    });
} else {
    logger = createLogger({
        level: 'info',
        format: combine(
            timestamp(),
            format.colorize(),
            myFormat,
        ),
        transports: [
            new transports.Console({
                format: combine(
                    timestamp(),
                    format.colorize(),
                    myFormat,
                ),
                level: 'info'
            }),
        ],
        exceptionHandlers: [
            new transports.Console({
                format: combine(
                    timestamp(),
                    format.colorize(),
                    myFormat,
                )
            })
        ]
    });
}


export default logger;