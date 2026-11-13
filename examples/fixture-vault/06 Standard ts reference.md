# Standard ts block (highlight reference)

```ts
// line comment
/** doc comment */
import type { Thing } from "./thing";
const greeting: string = "hello" + `tmpl ${1}`;
let count = 42, ratio = 3.14, big = 10n, flag = true, nothing = null;
interface Shape { kind: "circle"; radius: number }
type Alias<T> = Shape | T[];
class Point extends Base { private x = 0; get value() { return this.x; } }
function area(shape: Shape): number { return Math.PI * shape.radius ** 2; }
const result = area({ kind: "circle", radius: 2 }).toFixed(2);
async function run() { await Promise.resolve(/re+gex/g.test("x")); }
```

```km-ts
// line comment
const greeting: string = "hello";
```
