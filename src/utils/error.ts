class CustomError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.status = status;
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

function error(msg: string = 'Something Went Wrong', status: number = 500): CustomError {
    return new CustomError(msg, status);
}

export default error;



















