# Callouts

> [!note] Plain callout with a typed block
> ```km-ts
> const page = km.getPageInfo("Home");
> if (a > b) { console.log(page); }
> ```

> [!warning]- Folded callout
> ```km-ts
> const folded = 1;
> ```

> [!info] Nested callout
> > [!tip] Inner
> > ```km-ts
> > const nested = 2;
> > ```

> [!note] Code containing a quote-like operator at line start
> ```km-ts
> > 1 ? "gt" : "no";
>  const twoSpaces = 2;
> ```

> [!note] Callout with no space after the quote marker on code lines
>```km-ts
>const tight = 3;
>```

> [!note] Unclosed fence inside a callout ends with the callout
> ```km-ts
> const unclosed = 4;

Text after the callout is not code.
