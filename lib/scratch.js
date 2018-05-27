function Foo() {
  this.bar = "A"
  return 5
}


var p = new Foo()

console.log(p.color);

Foo.prototype.color = "Black"

console.log(p.color);

console.log(p);
var q = new foo()
console.log(q);
