export function formatTableName(topic: string) {
    return topic.toLocaleLowerCase().replace(/\W/gi, '_');
}

export function capitalize(word: string) {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

export function camelCase(text: string) {
    return text.split(/[^a-zA-Z0-9]/).map(capitalize).join('');
}