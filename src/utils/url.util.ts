export  const removeAkiPolicy = (url: string): string => {
    if (!url) {
        return "";
    }
    const queryStartIndex = url.indexOf("?");
    if (queryStartIndex === -1) {
        return url;
    }
    return url.substring(0, queryStartIndex);
};

export function filterValidURLs(arr: string[]): string[] {
    // Helper function to check if a string is a valid URL
    const isValidURL = (url: string): boolean => {
        try {
            new URL(url);
            return true;
        } catch (error) {
            return false;
        }
    };

    // Filter out empty strings and invalid URLs
    return arr.filter((element) => element !== '' && isValidURL(element));
}
