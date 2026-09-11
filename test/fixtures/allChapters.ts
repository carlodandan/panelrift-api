//
// Synthetic fixture mirroring the structural shape of the upstream
// `/all-chapters/` page: li[data-chapterno] > a[href][title] >
// (span.chapter-no, strong.chapter-title, time.chapter-update[datetime]).
//
// Deliberate edge cases:
//   - `datetime` uses the "a.m."/"p.m." style that Date.parse rejects unaided
//   - one entry has a non-numeric label (side story) to check label passthrough
//   - one entry has no time element at all

export const ALL_CHAPTERS_HTML = `
<ul class="chapter-list" start="1" style="height: 500px;overflow-y: scroll">
  <li data-chapterno="1" data-volumeno="0" data-orderno="900003">
    <a href="/reader/en/alpha-tale-chapter-206-side-story-eng-li/" title="Chapter 206">
      <span class="chapter-no "><i class="fas fa-paper-plane"></i></span>
      <strong class="chapter-title">206-side-story</strong>
      <time class="chapter-update" datetime="July 13, 2024, 5:46 a.m.">2 years ago</time>
    </a>
  </li>
  <li data-chapterno="1" data-volumeno="0" data-orderno="900002">
    <a href="/reader/en/alpha-tale-chapter-205-eng-li/" title="Chapter 205">
      <span class="chapter-no "><i class="fas fa-paper-plane"></i></span>
      <strong class="chapter-title">Chapter: 205</strong>
      <time class="chapter-update" datetime="July 10, 2024, 11:02 p.m.">2 years ago</time>
    </a>
  </li>
  <li data-chapterno="1" data-volumeno="0" data-orderno="900001">
    <a href="/reader/en/alpha-tale-chapter-204-eng-li/" title="Chapter 204">
      <span class="chapter-no "><i class="fas fa-paper-plane"></i></span>
      <strong class="chapter-title"></strong>
    </a>
  </li>
</ul>
`;
