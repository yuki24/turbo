import { FetchResponse } from "./fetch_response"
import { dispatch } from "../util"

export interface FetchRequestDelegate {
  prepareHeadersForRequest?(headers: FetchRequestHeaders, request: FetchRequest): void
  requestStarted(request: FetchRequest): void
  requestPreventedHandlingResponse(request: FetchRequest, response: FetchResponse): void
  requestSucceededWithResponse(request: FetchRequest, response: FetchResponse): void
  requestFailedWithResponse(request: FetchRequest, response: FetchResponse): void
  requestErrored(request: FetchRequest, error: Error): void
  requestFinished(request: FetchRequest): void
}

export enum FetchMethod {
  get,
  post,
  put,
  patch,
  delete
}

export function fetchMethodFromString(method: string) {
  switch (method.toLowerCase()) {
    case "get":    return FetchMethod.get
    case "post":   return FetchMethod.post
    case "put":    return FetchMethod.put
    case "patch":  return FetchMethod.patch
    case "delete": return FetchMethod.delete
  }
}

export type FetchRequestBody = FormData | URLSearchParams

export type FetchRequestHeaders = { [header: string]: string }

export interface FetchRequestOptions {
  headers: FetchRequestHeaders
  body: FetchRequestBody
  followRedirects: boolean
}

export class FetchRequest {
  readonly delegate: FetchRequestDelegate
  readonly method: FetchMethod
  readonly headers: FetchRequestHeaders
  readonly url: URL
  readonly body?: FetchRequestBody
  readonly abortController = new AbortController

  constructor(delegate: FetchRequestDelegate, method: FetchMethod, location: URL, body: FetchRequestBody = new URLSearchParams) {
    this.delegate = delegate
    this.method = method
    if (this.isIdempotent) {
      this.url = mergeFormDataEntries(location, [ ...body.entries() ])
    } else {
      this.body = body
      this.url = location
    }
    this.headers = prepareHeadersForRequest(this)
  }

  get location(): URL {
    return this.url
  }

  get params(): URLSearchParams {
    return this.url.searchParams
  }

  get entries() {
    return this.body ? Array.from(this.body.entries()) : []
  }

  cancel() {
    this.abortController.abort()
  }

  async perform(): Promise<FetchResponse> {
    const { fetchOptions } = this
    dispatch("turbo:before-fetch-request", { detail: { fetchOptions } })
    try {
      this.delegate.requestStarted(this)
      const response = await fetch(this.url.href, fetchOptions)
      return await this.receive(response)
    } catch (error) {
      this.delegate.requestErrored(this, error)
      throw error
    } finally {
      this.delegate.requestFinished(this)
    }
  }

  async receive(response: Response): Promise<FetchResponse> {
    const fetchResponse = new FetchResponse(response)
    const event = dispatch("turbo:before-fetch-response", { cancelable: true, detail: { fetchResponse } })
    if (event.defaultPrevented) {
      this.delegate.requestPreventedHandlingResponse(this, fetchResponse)
    } else if (fetchResponse.succeeded) {
      this.delegate.requestSucceededWithResponse(this, fetchResponse)
    } else {
      this.delegate.requestFailedWithResponse(this, fetchResponse)
    }
    return fetchResponse
  }

  get fetchOptions(): RequestInit {
    return {
      method: FetchMethod[this.method].toUpperCase(),
      credentials: "same-origin",
      headers: this.headers,
      redirect: "follow",
      body: this.body,
      signal: this.abortSignal
    }
  }

  get isIdempotent() {
    return this.method == FetchMethod.get
  }

  get abortSignal() {
    return this.abortController.signal
  }
}

function prepareHeadersForRequest(fetchRequest: FetchRequest) {
  const headers = { "Accept": "text/html, application/xhtml+xml" }
  if (typeof fetchRequest.delegate.prepareHeadersForRequest == "function") {
    fetchRequest.delegate.prepareHeadersForRequest(headers, fetchRequest)
  }
  return headers
}

function mergeFormDataEntries(url: URL, entries: [string, FormDataEntryValue][]): URL {
  const currentSearchParams = new URLSearchParams(url.search)

  for (const [ name, value ] of entries) {
    if (value instanceof File) continue

    if (currentSearchParams.has(name)) {
      currentSearchParams.delete(name)
      url.searchParams.set(name, value)
    } else {
      url.searchParams.append(name, value)
    }
  }

  return url
}
