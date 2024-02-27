export function generateRandomNumber(length: number):number {
    if (length <= 0) {
        return null;
    }

    let randomNumber = '';
    for (let i = 0; i < length; i++) {
        randomNumber += Math.floor(Math.random() * 10);
    }

    return Number(randomNumber);
}
