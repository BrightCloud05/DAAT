/** A window may close only after its registered renderer has saved or recovered edits. */
export class WindowCloseGuard {
  private requests = new Map<number, { id: string; promise: Promise<void>; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  constructor(private send: (windowId: number, requestId: string) => void, private timeoutMs = 15_000) {}
  request(windowId: number): Promise<void> {
    const existing = this.requests.get(windowId)

    if (existing) {return existing.promise}
    const id = `${windowId}:${Date.now()}:${Math.random()}`
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    const timer = setTimeout(() => this.respond(windowId, id, false, 'Saving did not finish. The window was kept open.'), this.timeoutMs)
    this.requests.set(windowId, { id, promise, resolve, reject, timer })

    try { this.send(windowId, id) } catch (error: any) { this.respond(windowId, id, false, error.message) }

    return promise
  }
  respond(windowId: number, requestId: string, ok: boolean, message = 'Could not save your changes. The window was kept open.'): void {
    const request = this.requests.get(windowId)

    if (!request || request.id !== requestId) {return}
    clearTimeout(request.timer)
    this.requests.delete(windowId)

    if (ok) {request.resolve()}
    else {request.reject(new Error(message))}
  }
  forget(windowId: number): void {
    const request = this.requests.get(windowId)

    if (request) {this.respond(windowId, request.id, false, 'The editor disconnected before saving finished.')}
  }
}
