class AsyncLocalStorage {
  constructor() {
    this.store = undefined;
  }

  getStore() {
    return this.store;
  }

  run(store, callback) {
    const previous = this.store;
    this.store = store;
    let result;
    try {
      result = callback();
    } catch (error) {
      this.store = previous;
      throw error;
    }
    if (result && typeof result.then === 'function') {
      return result.finally(() => {
        this.store = previous;
      });
    }
    this.store = previous;
    return result;
  }

  exit(callback) {
    const previous = this.store;
    this.store = undefined;
    try {
      return callback();
    } finally {
      this.store = previous;
    }
  }
}

const api = {
  AsyncLocalStorage,
};

module.exports = api;
module.exports.default = api;
