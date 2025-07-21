import * as assert from "assert";

suite("Simple Test Suite", () => {
  test("Basic assertion test", () => {
    assert.strictEqual(1 + 1, 2, "Basic math should work");
  });

  test("String test", () => {
    assert.strictEqual("hello", "hello", "String comparison should work");
  });

  test("Array test", () => {
    const arr = [1, 2, 3];
    assert.strictEqual(arr.length, 3, "Array length should be correct");
  });

  test("Object test", () => {
    const obj = { name: "test", value: 42 };
    assert.strictEqual(obj.name, "test", "Object property should be correct");
    assert.strictEqual(obj.value, 42, "Object value should be correct");
  });
});
