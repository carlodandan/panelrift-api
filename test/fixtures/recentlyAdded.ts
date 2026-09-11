//
// Synthetic fixture mirroring the structural shape of the card grid upstream
// returns in the browse endpoint's `results_html`: article.comic-card >
// (.comic-card__cover > (span.comic-card__badge, a > img[src][alt]),
// .comic-card__content > (h3.comic-card__title > a, p.comic-card__description,
// .comic-card__stats > (.comic-card__stat--hot > span.stat-weekly|monthly|alltime,
// .comic-card__stat--rating))).
//
// Content is invented. Deliberate edge cases:
//   - card 1: h3 truncated with an ellipsis while `alt` holds the full title,
//     entities in both, badge present, rating present, absolute proxy cover
//   - card 2: relative /media/ cover, no badge, no rating span
//   - card 3: shared default-placeholder cover (must resolve to null)
//   - card 4: no anchor at all (must be skipped entirely)
//
// The upstream fragment keeps the whitespace and empty `{% %}`-shaped gaps its
// template leaves behind, so the parser is exercised against those too.

export const RECENTLY_ADDED_HTML = `


  <article class="comic-card">
    <div class="comic-card__cover">


        <span class="comic-card__badge comic-card__badge--trending">Trending</span>


      <a href="/manga/alpha-tale-x1/">

          <img src="https://imgsrv5.com/avatar/157x211/media/manga_covers/alpha.png" alt="Alpha &amp; Omega&#x27;s Tale: A Very Long Subtitle That Upstream Keeps Whole">

      </a>
    </div>

    <div class="comic-card__content">
      <h3 class="comic-card__title">
        <a href="/manga/alpha-tale-x1/">
          Alpha &amp; Omega&#x27;s Tale: A Very Long Subtitle That Upstream Keeps W&hellip;
        </a>
      </h3>

      <div class="comic-card__meta">


      </div>

      <p class="comic-card__description">
        A quiet clerk discovers a door in the stockroom.\r\n\r\nWhat waits on the other side isn&#x27;t what the sign promi&hellip;
      </p>

      <div class="comic-card__stats">

          <span class="comic-card__stat comic-card__stat--hot">
            🔥
            <span class="stat-weekly">116,557</span>
            <span class="stat-monthly">116,557</span>
            <span class="stat-alltime">116,557</span>
          </span>


          <span class="comic-card__stat comic-card__stat--rating">
            ⭐ 4.9
          </span>

      </div>

      <div class="comic-card__action">
        <a href="/manga/alpha-tale-x1/" class="comic-card__button">
          ▶ Read Now
        </a>
      </div>
    </div>
  </article>

  <article class="comic-card">
    <div class="comic-card__cover">


      <a href="/manga/beta-journey-x2/">
        <img src="/media/manga_covers/beta.png" alt="Beta Journey">
      </a>
    </div>

    <div class="comic-card__content">
      <h3 class="comic-card__title">
        <a href="/manga/beta-journey-x2/">
          Beta Journey
        </a>
      </h3>

      <p class="comic-card__description">
        Two rivals, one road.
      </p>

      <div class="comic-card__stats">
          <span class="comic-card__stat comic-card__stat--hot">
            🔥
            <span class="stat-weekly">1,024</span>
            <span class="stat-monthly">1,024</span>
            <span class="stat-alltime">1,024</span>
          </span>
      </div>

      <div class="comic-card__action">
        <a href="/manga/beta-journey-x2/" class="comic-card__button">▶ Read Now</a>
      </div>
    </div>
  </article>

  <article class="comic-card">
    <div class="comic-card__cover">
      <a href="/manga/gamma-void-x3/">
        <img src="/media/manga_covers/default-placeholder.png" alt="Gamma Void">
      </a>
    </div>

    <div class="comic-card__content">
      <h3 class="comic-card__title"><a href="/manga/gamma-void-x3/">Gamma Void</a></h3>
      <p class="comic-card__description"></p>
      <div class="comic-card__stats"></div>
    </div>
  </article>

  <article class="comic-card">
    <div class="comic-card__cover">
      <span>Broken entry with no anchor</span>
    </div>
    <div class="comic-card__content">
      <h3 class="comic-card__title">Delta Drift</h3>
    </div>
  </article>

`;
