export class CircularBuffer<T> {
  private buffer: Array<T | undefined>;
  private capacity: number;
  private head: number = 0;
  private tail: number = 0;
  private isFullState: boolean = false;

  constructor(capacity: number) {
    if (capacity <= 0) {
      throw new Error('Capacity must be greater than 0');
    }
    this.capacity = capacity;
    this.buffer = new Array<T | undefined>(capacity);
  }

  public push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;

    if (this.isFullState) {
      this.head = (this.head + 1) % this.capacity;
    } else if (this.tail === this.head) {
      this.isFullState = true;
    }
  }

  public get(index: number): T | undefined {
    if (index < 0 || index >= this.size()) {
      return undefined;
    }
    const actualIndex = (this.head + index) % this.capacity;
    return this.buffer[actualIndex];
  }

  public size(): number {
    if (this.isFullState) {
      return this.capacity;
    }
    if (this.tail >= this.head) {
      return this.tail - this.head;
    }
    return this.capacity - this.head + this.tail;
  }

  public getCapacity(): number {
    return this.capacity;
  }

  public isEmpty(): boolean {
    return this.size() === 0;
  }

  public isFull(): boolean {
    return this.isFullState;
  }

  public clear(): void {
    this.head = 0;
    this.tail = 0;
    this.isFullState = false;
    for (let i = 0; i < this.capacity; i++) {
      this.buffer[i] = undefined;
    }
  }

  public toArray(): T[] {
    const result: T[] = [];
    const currentSize = this.size();
    for (let i = 0; i < currentSize; i++) {
      result.push(this.get(i) as T);
    }
    return result;
  }
}
