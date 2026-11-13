---
example: |
  ```km-ts
  const inFrontmatter = 1;
  ```
---

# Frontmatter, HTML blocks and indented code

<div>
```km-ts
const inHtml = 2;
```
</div>

    ```km-ts
    const inIndentedCode = 3;
    ```

````md
```km-ts
const insideOuterFence = 4;
```
````

~~~km-ts
const tildeFence = 5;
~~~

```km-ts extra words ignored
const withInfoWords = 6;
```

```KM-TS
const wrongCase = 7;
```

```km-ts
```
