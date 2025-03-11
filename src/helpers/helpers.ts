import { v4 as uuidv4 } from 'uuid';

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

export function generateAPIKey(): string {
    return uuidv4();
}

export function removeNullValues(obj: Object) {
    return Object.fromEntries(
        Object.entries(obj).filter(([key, value]) => value !== null)
    );
}

export function isReactionMessage(message) {
    return /^.+ reacted .+ to your message /.test(message);
}

export const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount)
        .replace('$', '$ ');
};

