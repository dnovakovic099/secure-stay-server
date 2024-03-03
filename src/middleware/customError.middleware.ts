class CustomErrorHandler {
    status: number;
    message: string;

    constructor(status: number, msg: string) {
        this.status = status;
        this.message=msg
    }

    static alreadyExists(message: string): CustomErrorHandler {
        return new CustomErrorHandler(409, message);
    }

    static unAthorized(message: string = "Unauthorized"): CustomErrorHandler {
        return new CustomErrorHandler(401, message);
    }

    static duplicate(message: string): CustomErrorHandler {
        return new CustomErrorHandler(400, message);
    }

    static validationError(message: string = "validation error"): CustomErrorHandler {
        return new CustomErrorHandler(400, message);
    }

    static forbidden(message: string = "You do not have permission to access this resource"): CustomErrorHandler {
        return new CustomErrorHandler(403, message);
    }
}

export default CustomErrorHandler;
