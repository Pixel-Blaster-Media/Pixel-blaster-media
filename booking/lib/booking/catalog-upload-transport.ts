/** tus-js-client 4.3.1 settles XHR errors, but does not handle timeout events. */
export function configureCatalogUploadRequest(xhr: XMLHttpRequest): void {
  xhr.timeout = 300_000;
  xhr.ontimeout = () => xhr.dispatchEvent(new Event("error"));
}
