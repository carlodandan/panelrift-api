//
// Synthetic fixture mirroring the structural shape of the upstream autocomplete
// fragment: ul > li.novel-item > a[href][title] > (figure img, h4.novel-title,
// div.novel-stats > strong + span + span[style]).
//
// Content is invented. Deliberate edge cases:
//   - item 1: absolute cover, HTML entities in the title
//   - item 2: relative cover (must be resolved), no rating span
//   - item 3: no href (must be skipped entirely)

export const SEARCH_HTML = `
<ul style="overflow-y: auto;max-height:85vh" class="novel-list grid col col1 results-wrapper">
  <li class="novel-item">
    <a href="/manga/alpha-tale-x1/" title="Alpha &amp; Omega&#39;s Tale">
      <div class="cover-wrap">
        <figure class="novel-cover">
          <img src="https://cdn.example.test/covers/alpha.jpg"
               onerror="this.onerror=null; this.src='https://cdn2.example.test/covers/alpha.jpg';"
               alt="Alpha">
        </figure>
      </div>
      <h4 class="novel-title text1row"><mark>Alpha</mark> &amp; Omega&#39;s Tale</h4>
      <div class="novel-stats">
        <strong>Chapter 128</strong><span> &middot; 3 hours ago</span>
        <span style="color:#f5a623;">&#9733; 8.7</span>
      </div>
    </a>
  </li>
  <li class="novel-item">
    <a href="/manga/beta-journey-x2/" title="Beta Journey">
      <div class="cover-wrap">
        <figure class="novel-cover">
          <img src="/media/manga_covers/beta.png" alt="Beta">
        </figure>
      </div>
      <h4 class="novel-title text1row">Beta Journey</h4>
      <div class="novel-stats">
        <strong>Chapter 7</strong><span> &middot; 2 days ago</span>
      </div>
    </a>
  </li>
  <li class="novel-item">
    <span>Broken entry with no anchor</span>
  </li>
</ul>
`;
