import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  archFromFileName,
  fileNameFromUrl,
  parseDownloadOptions,
  parseOvdfChallenge,
  parseProductEditionOptions,
  parseSkus,
  pickDownloadOption,
  pickProductEdition,
  pickSku,
} from '../src/windows/microsoft.js';

const PRODUCT_PAGE_HTML = `
<html><body>
<select id="product-edition" name="product-edition">
  <option value="">Select Download</option>
  <option value="3113">Windows 11 (multi-edition ISO for x64 devices)</option>
  <option value="3131">Windows 11 (multi-edition ISO for Arm64 devices)</option>
</select>
<select id="unrelated"><option value="12">Nope</option></select>
</body></html>`;

const SKU_JSON = {
  Skus: [
    { Id: '20046', Language: 'English', LocalizedLanguage: 'English' },
    { Id: '20047', Language: 'English International', LocalizedLanguage: 'English International' },
    { Id: '20069', Language: 'Spanish', LocalizedLanguage: 'Espa\u00f1ol' },
  ],
};

const LINKS_JSON = {
  ProductDownloadOptions: [
    { Uri: 'https://software.download.prss.microsoft.com/dbazure/Win11_25H2_English_x64_v2.iso?t=abc&P1=1', DownloadType: 1 },
    { Uri: 'https://software.download.prss.microsoft.com/dbazure/Win11_25H2_English_arm64_v2.iso?t=abc&P1=1', DownloadType: 2 },
  ],
};

describe('product edition parsing', () => {
  it('extracts the numeric options and ignores short ids from other selects', () => {
    const options = parseProductEditionOptions(PRODUCT_PAGE_HTML);
    assert.deepEqual(options, [
      { id: '3113', label: 'Windows 11 (multi-edition ISO for x64 devices)' },
      { id: '3131', label: 'Windows 11 (multi-edition ISO for Arm64 devices)' },
    ]);
  });

  it('picks the option matching the requested architecture', () => {
    const options = parseProductEditionOptions(PRODUCT_PAGE_HTML);
    assert.equal(pickProductEdition(options, 'x64')?.id, '3113');
    assert.equal(pickProductEdition(options, 'arm64')?.id, '3131');
  });

  it('returns nothing for arm64 when the page has no arm64 build', () => {
    const options = parseProductEditionOptions('<option value="3113">Windows 11 (multi-edition ISO for x64 devices)</option>');
    assert.equal(pickProductEdition(options, 'arm64'), undefined);
  });

  it('tolerates a page with no options at all', () => {
    assert.deepEqual(parseProductEditionOptions('<html></html>'), []);
  });
});

describe('sku parsing', () => {
  it('reads the language list', () => {
    const skus = parseSkus(SKU_JSON);
    assert.equal(skus.length, 3);
    assert.equal(skus[0]!.id, '20046');
  });

  it('matches Microsoft language names exactly before falling back', () => {
    const skus = parseSkus(SKU_JSON);
    assert.equal(pickSku(skus, 'English')?.id, '20046');
    assert.equal(pickSku(skus, 'English International')?.id, '20047');
    assert.equal(pickSku(skus, 'spanish')?.id, '20069');
    assert.equal(pickSku(skus, 'Klingon'), undefined);
  });

  it('does not fall over on an unexpected payload', () => {
    assert.deepEqual(parseSkus({}), []);
    assert.deepEqual(parseSkus(null), []);
  });
});

describe('download link parsing', () => {
  it('derives the file name and architecture from the URL', () => {
    assert.equal(fileNameFromUrl('https://host/path/Win11_25H2_English_x64_v2.iso?t=1'), 'Win11_25H2_English_x64_v2.iso');
    assert.equal(archFromFileName('Win11_25H2_English_x64_v2.iso'), 'x64');
    assert.equal(archFromFileName('Win11_25H2_English_arm64_v2.iso'), 'arm64');
    assert.equal(archFromFileName('mystery.iso'), 'unknown');
  });

  it('prefers Microsoft\'s own DownloadType code over the file name', () => {
    const options = parseDownloadOptions({
      ProductDownloadOptions: [{ Uri: 'https://host/mystery.iso', DownloadType: 2 }],
    });
    assert.equal(options[0]!.arch, 'arm64');
  });

  it('selects the link for the requested architecture', () => {
    const options = parseDownloadOptions(LINKS_JSON);
    assert.equal(options.length, 2);
    assert.match(pickDownloadOption(options, 'arm64')!.fileName, /arm64/);
    assert.match(pickDownloadOption(options, 'x64')!.fileName, /x64/);
  });

  it('rejects non-https links', () => {
    const options = parseDownloadOptions({ ProductDownloadOptions: [{ Uri: 'http://evil.example/iso' }] });
    assert.deepEqual(options, []);
  });

  it('falls back to the only option when the architecture is unknown', () => {
    const options = parseDownloadOptions({ ProductDownloadOptions: [{ Uri: 'https://host/mystery.iso' }] });
    assert.equal(pickDownloadOption(options, 'x64')?.fileName, 'mystery.iso');
  });
});

describe('anti-automation challenge', () => {
  it('extracts the w and rticks values from mdt.js', () => {
    const script = 'var u="https://ov-df.microsoft.com/?w=A1B2C3D4EF&PageId=si";var t="&rticks="+123456789;';
    assert.deepEqual(parseOvdfChallenge(script), { w: 'A1B2C3D4EF', rticks: '123456789' });
  });

  it('returns null when the challenge cannot be understood', () => {
    assert.equal(parseOvdfChallenge('console.log("nothing here")'), null);
  });
});
