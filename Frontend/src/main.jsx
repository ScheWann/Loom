import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const baseUrl = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
const apiPrefix = `${baseUrl || ''}/api`;
const nativeFetch = window.fetch.bind(window);

window.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/api')) {
        return nativeFetch(`${apiPrefix}${input.slice(4)}`, init);
    }

    if (input instanceof Request) {
        const originApi = `${window.location.origin}/api`;
        if (input.url.startsWith(originApi)) {
            const rewrittenUrl = `${window.location.origin}${apiPrefix}${input.url.slice(originApi.length)}`;
            return nativeFetch(new Request(rewrittenUrl, input), init);
        }
    }

    return nativeFetch(input, init);
};

ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
);