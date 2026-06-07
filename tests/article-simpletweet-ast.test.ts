import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { domToAst } from '../src/content/dom-to-ast';
import { renderMarkdown } from '../src/ast/render-markdown';

function loadArticle(html: string): void {
  const url = 'https://x.com/theonejvo/status/2015401219746128322';
  const dom = new JSDOM(html, { url });
  document.documentElement.replaceWith(
    dom.window.document.documentElement.cloneNode(true) as HTMLElement
  );
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname: new URL(url).pathname, href: url },
    writable: true,
    configurable: true,
  });
}

describe('domToAst() article simpleTweet embeds', () => {
  it('preserves embedded tweets in X Article bodies', () => {
    loadArticle(`
      <html>
        <body>
          <article role="article">
            <div data-testid="User-Name">
              <a href="/theonejvo"><span>Jamieson O'Reilly</span></a>
              <a href="/theonejvo"><span>@theonejvo</span></a>
            </div>
            <time datetime="2026-01-01T00:00:00.000Z"></time>
            <div data-testid="twitter-article-title">Embedded tweet</div>
            <div data-testid="twitterArticleRichTextView">
              <div data-testid="longformRichTextComponent">
                <div data-contents="true">
                  <section>
                    <div data-testid="simpleTweet">
                      <article role="article" data-testid="tweet">
                        <div data-testid="User-Name">
                          <a href="/AlexFinn"><span>Alex Finn</span></a>
                          <a href="/AlexFinn"><span>@AlexFinn</span></a>
                        </div>
                        <a href="/AlexFinn/status/2015182480064893118">
                          <time datetime="2026-01-24T21:58:38.000Z"></time>
                        </a>
                        <div data-testid="tweetText">This is it. The most important video you'll watch this year.</div>
                        <div data-testid="tweetPhoto">
                          <img src="https://pbs.twimg.com/amplify_video_thumb/2015181527802687488/img/hcdMrX1kztalGFEB.jpg" alt="Embedded video">
                        </div>
                        <video poster="https://pbs.twimg.com/amplify_video_thumb/2015181527802687488/img/hcdMrX1kztalGFEB.jpg"></video>
                      </article>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </article>
        </body>
      </html>
    `);

    const ast = domToAst();
    expect(ast.body.type).toBe('article');
    if (ast.body.type !== 'article') return;

    expect(ast.body.children[0]).toMatchObject({
      type: 'tweet',
      author: { name: 'Alex Finn', handle: 'AlexFinn' },
      tweetId: '2015182480064893118',
      text: [{ type: 'text', value: "This is it. The most important video you'll watch this year." }],
      media: [{
        kind: 'video',
        url: 'https://pbs.twimg.com/amplify_video_thumb/2015181527802687488/img/hcdMrX1kztalGFEB.jpg',
        posterUrl: 'https://pbs.twimg.com/amplify_video_thumb/2015181527802687488/img/hcdMrX1kztalGFEB.jpg',
      }],
    });

    const markdown = renderMarkdown(ast);
    expect(markdown).toContain('> **Alex Finn (@AlexFinn)**');
    expect(markdown).toContain("> This is it. The most important video you'll watch this year.");
    expect(markdown).toContain('> ![🎥 Video](https://pbs.twimg.com/amplify_video_thumb/2015181527802687488/img/hcdMrX1kztalGFEB.jpg)');
  });
});
