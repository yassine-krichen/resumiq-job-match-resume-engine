import { htmlToText } from './snapshot-text';

describe('htmlToText', () => {
  it('drops scripts, styles and comments but keeps visible text', () => {
    const text = htmlToText(
      '<html><head><style>p{color:red}</style><script>var x = "<b>no</b>";</script></head>' +
        '<body><!-- hidden --><p>Hello world</p></body></html>',
    );

    expect(text).toBe('Hello world');
  });

  it('puts block elements on separate lines and joins inline elements without a gap', () => {
    const text = htmlToText('<h1>We build</h1><p>fleet <b>sched</b>ulers</p><ul><li>One</li><li>Two</li></ul>');

    expect(text.split('\n')).toEqual(['We build', 'fleet schedulers', 'One', 'Two']);
  });

  it('decodes named and numeric entities, so a copied quote still matches', () => {
    const text = htmlToText('<p>Today we&rsquo;re open&#45;sourcing &laquo;Acme&raquo; &amp; &#x41;ll</p>');

    expect(text).toBe('Today we’re open-sourcing «Acme» & All');
  });

  it('leaves an unknown or out-of-range entity as written instead of throwing', () => {
    expect(htmlToText('<p>&bogus; &#99999999999;</p>')).toBe('&bogus; &#99999999999;');
  });

  it('collapses runs of spaces, tabs and non-breaking spaces', () => {
    expect(htmlToText('<p>a \t  b&nbsp;&nbsp;c</p>')).toBe('a b c');
  });
});
