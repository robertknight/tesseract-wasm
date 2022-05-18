export function timeIt(label, callback) {
  const start = performance.now();
  const result = callback();
  if (typeof result?.then === "function") {
    return result.then((value) => {
      const end = performance.now();
      console.log(`${label} took ${end - start}ms`);
      return value;
    });
  } else {
    const end = performance.now();
    console.log(`${label} took ${end - start}ms`);
    return result;
  }
}
