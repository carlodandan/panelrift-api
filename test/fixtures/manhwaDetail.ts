//
// Synthetic fixture mirroring the structural shape of an upstream series detail
// page. Content is invented; only the markup skeleton reflects upstream.
//
// Deliberate edge cases:
//   - cover is lazy-loaded: `src` is a placeholder, `data-src` is the real image
//   - stat values are prefixed by Material Icons ligature text (must be stripped)
//   - the description contains entities and spans multiple text nodes
//   - chapter labels sit in div.chapter-number with a nested span.chapter-stats date

export const MANHWA_DETAIL_HTML = `
<div class="novel-body container">
  <div class="fixed-img">
    <figure class="cover">
      <img class="lazy"
           src="https://cdn.example.test/covers/default-placeholder.png"
           data-src="/media/manga_covers/alpha.jpg" alt="Alpha" />
    </figure>
  </div>
  <div class="novel-info">
    <div class="main-head">
      <h1 itemprop="name" class="novel-title text2row">Alpha &amp; Omega&#39;s Tale</h1>
      <h2 class="alternative-title text1row">Alpha to Omega / &#51221;&#48372;</h2>
      <div class="author">
        <span>Author</span>
        <a href='#' title="Some Author" class="property-item">
          <span itemprop="author">Some Author</span>
        </a>
      </div>
      <div class="rating">
        <div class="rating-star" itemprop="aggregateRating">
          <span class="star-wrap"><svg class="star star-on"><use xlink:href="#star"></use></svg></span>
          <strong>8.7<span style="font-size:12px"> (12,345) </span></strong>
        </div>
      </div>
      <div class="header-stats">
        <span>
          <strong><i class="material-icons">visibility</i>4.2M</strong>
          <small>Views</small>
        </span>
        <span>
          <strong><i class="material-icons">bookmark</i>88.1K</strong>
          <small>Bookmarked</small>
        </span>
        <span>
          <strong><i class="material-icons">menu_book</i>205</strong>
          <small>Chapters</small>
        </span>
        <span>
          <strong class="completed">Completed</strong>
          <small>Status</small>
        </span>
      </div>
      <div class="updinfo">
        <span>Updated</span>
        <strong>2 years ago</strong>
      </div>
      <div class="categories">
        <strong>Genres</strong>
        <ul>
          <li><a href="/browse-comics/?genre_included=Action&minchaps=0" title="Action" class="property-item">Action</a></li>
          <li><a href="/browse-comics/?genre_included= Fantasy&minchaps=0" title="Fantasy" class="property-item"> Fantasy </a></li>
          <li><a href="/browse-comics/?genre_included=manhwa&minchaps=0" title="Manhwa" class="property-item">Manhwa</a></li>
        </ul>
      </div>
    </div>
  </div>
  <div class="summary">
    <p class="description">The Summary is <br><br> A quiet clerk discovers a door that
    should not exist &mdash; and the ledger behind it isn&#39;t written in any language
    they know.</p>
  </div>
  <ul class="chapter-list" start="1" style="height: 500px;overflow-y: scroll">
    <li data-chapterno="1" data-volumeno="0" data-orderno="900002" class="chapter-list-item">
      <span class="chapter-no "><i class="far fa-eye-slash vieweye"></i></span>
      <a href="/reader/en/alpha-tale-chapter-205-eng-li/">
        <div class="chapter-li-data">
          <div class="chapter-number">Chapter 205
            <span class="chapter-stats">2 years ago</span>
          </div>
        </div>
      </a>
    </li>
    <li data-chapterno="1" data-volumeno="0" data-orderno="900001" class="chapter-list-item">
      <span class="chapter-no "><i class="far fa-eye-slash vieweye"></i></span>
      <a href="/reader/en/alpha-tale-chapter-204-eng-li/">
        <div class="chapter-li-data">
          <div class="chapter-number">Chapter 204
            <span class="chapter-stats">2 years ago</span>
          </div>
        </div>
      </a>
    </li>
  </ul>
</div>
`;
