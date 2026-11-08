import { NearBindgen, call, view } from 'near-sdk-js';

class Counter {
  count = 0;

  increment() {
    this.count += 1;
  }

  get() {
    return this.count;
  }
}

call({})(Counter.prototype, 'increment');
view({})(Counter.prototype, 'get');

export default NearBindgen({})(Counter);
