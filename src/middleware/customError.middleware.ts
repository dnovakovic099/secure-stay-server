class CustomErrorHandler {
    status: number;
    message: string;
    data?: any;

    constructor(status: number, msg: string, data?: any) {
        this.status = status;
        this.message=msg;
        this.data = data;
    }

    static alreadyExists(message: string, data?: any): CustomErrorHandler {
        return new CustomErrorHandler(409, message, data);
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

    static notFound(message: string = 'Not found') {
        return new CustomErrorHandler(404, message);
    }
}

export default CustomErrorHandler;
