/**
 * SPDX-License-Identifier: MIT
 */
export function throttle<T extends (...args: unknown[]) => unknown>(fn: T, waitMs: number) {
    let lastCall = 0;

    return function throttled(...args: Parameters<T>) {
        const now = Date.now();
        if (now - lastCall >= waitMs) {
            lastCall = now;
            return fn(...args);
        }
        return undefined;
    };
}

export function debounce<T extends (...args: unknown[]) => unknown>(fn: T, waitMs: number) {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    return function debounced(...args: Parameters<T>) {
        if (timeout !== undefined) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(() => {
            fn(...args);
        }, waitMs);
    };
}
