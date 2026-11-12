// Automatic sequencing: after a drop within a list the rows keep the sort values that are there, handed along to
// match the new order. Only the rows between the old and the new place get another value.

import { ItemEntry, items } from "./registry";

export interface Assignment {
    entry: ItemEntry;
    value: string;
    index: number;
}

/** True when the values only go up, or only go down, without a value occurring twice. */
function strictlyOrdered(values: number[]): boolean {
    if (values.length < 2) {
        return true;
    }
    const up = values[1] > values[0];
    for (let i = 1; i < values.length; i++) {
        if (up ? values[i] <= values[i - 1] : values[i] >= values[i - 1]) {
            return false;
        }
    }
    return true;
}

/**
 * What each row must get so that `order` becomes the list's order.
 *
 * @param current the rows as the list has them now
 * @param order   the same rows in the order they must get
 * @returns the rows whose value changes; null when the rows are not the same ones (the list changed in between)
 *          or a row has no way to be changed
 */
export function plan(current: HTMLElement[], order: HTMLElement[]): Assignment[] | null {
    if (current.length !== order.length || order.some(row => current.indexOf(row) < 0)) {
        return null;
    }
    const entries = order.map(row => items.get(row));
    if (entries.some(entry => !entry || !entry.options.assign)) {
        return null;
    }
    const raw = current.map(row => items.get(row)?.options.sortValue);
    const numbers = raw.map(value => (value === undefined || value === "" ? NaN : Number(value)));
    // The values the places have now go to the rows that take those places. A list with a value twice, or without
    // one, cannot be handed along like that: it is numbered 1..n once.
    const usable = numbers.every(n => !Number.isNaN(n)) && strictlyOrdered(numbers);
    const values = usable ? (raw as string[]) : order.map((_, i) => String(i + 1));
    const changes: Assignment[] = [];
    order.forEach((_row, index) => {
        const entry = entries[index] as ItemEntry;
        const now = entry.options.sortValue;
        if (now === undefined || now === "" || Number(now) !== Number(values[index])) {
            changes.push({ entry, value: values[index], index });
        }
    });
    return changes;
}
