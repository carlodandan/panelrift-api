//
// Synthetic fixture mirroring the structural shape of an upstream reader page:
// h1 > a[href] (series), h2 (chapter heading), two div.chapternav blocks each
// holding a.prevchap / a.nextchap plus a select of every chapter, and page images
// as img[id^="image-"].
//
// Deliberate edge cases:
//   - both navs repeat the same prev/next links (must not double-count)
//   - one image is relative (must be resolved against the base URL)
//   - a decorative logo image and an avatar carry no image- id (must be ignored)
//   - a second h2 exists further down the page (must not overwrite the heading)

export const READER_HTML = `
<div class="page-in">
  <div class="chapter-header">
    <h1><a href="/manga/alpha-tale-x1/" title="Alpha Tale">Alpha &amp; Omega&#39;s Tale</a></h1>
    <h2>Chapter 205</h2>
  </div>
  <img src="/static/logo.png" alt="site logo" />
  <div class="chapternav skiptranslate" id="top">
    <a title="Chapter 204" class="prevchap " href="/reader/en/alpha-tale-chapter-204-eng-li/"><span>Prev</span></a>
    <center>
      <select name="cars" id="cars" onchange="location = this.value;">
        <option value="/reader/en/alpha-tale-chapter-205-eng-li/">Chapter: 205</option>
        <option value="/reader/en/alpha-tale-chapter-204-eng-li/">Chapter: 204</option>
      </select>
    </center>
    <a title="Chapter 206" class="nextchap " href="/reader/en/alpha-tale-chapter-206-side-story-eng-li/"><span>Next</span></a>
  </div>
  <div id="pages">
    <img src="https://img.example.test/mg2/alpha/205/01.jpg" onerror="tryAgain(this);" id="image-1">
    <img src="https://img.example.test/mg2/alpha/205/02.jpg" onerror="tryAgain(this);" id="image-2">
    <img src="/mg2/alpha/205/03.jpg" onerror="tryAgain(this);" id="image-3">
    <img height="50" width="50" src="https://img.example.test/avatar/user.png" alt="">
  </div>
  <h2>Comments</h2>
  <div class="chapternav skiptranslate" id="save">
    <a title="Chapter 204" class="prevchap " href="/reader/en/alpha-tale-chapter-204-eng-li/"><span>Prev</span></a>
    <center>
      <select name="cars" id="cars2" onchange="location = this.value;">
        <option value="/reader/en/alpha-tale-chapter-205-eng-li/">Chapter: 205</option>
      </select>
    </center>
    <a title="Chapter 206" class="nextchap " href="/reader/en/alpha-tale-chapter-206-side-story-eng-li/"><span>Next</span></a>
  </div>
  <img class="footer-logo" src="/static/logo-footer.png" alt="logo-footer">
</div>
`;

/** A reader page whose image markup has changed: no img[id^="image-"] at all. */
export const READER_HTML_NO_IMAGES = `
<div class="page-in">
  <div class="chapter-header">
    <h1><a href="/manga/alpha-tale-x1/" title="Alpha Tale">Alpha Tale</a></h1>
    <h2>Chapter 205</h2>
  </div>
  <div id="pages"><p>This chapter is unavailable.</p></div>
</div>
`;
