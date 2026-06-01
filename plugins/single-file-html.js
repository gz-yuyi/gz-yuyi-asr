function normalizeBundlePath(src) {
  return src.replace(/^\.\//, '').replace(/^\//, '');
}

function inlineAsset(bundle, src, render) {
  const fileName = normalizeBundlePath(src);
  const item = bundle[fileName];
  if (!item) return null;
  delete bundle[fileName];
  return render(item);
}

export function singleFileHtmlPlugin() {
  return {
    name: 'single-file-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type !== 'asset' || !fileName.endsWith('.html')) continue;

        let html = String(item.source);
        html = html.replace(/<link rel="modulepreload"[^>]*>\s*/g, '');
        html = html.replace(
          /<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
          (tag, href) => inlineAsset(bundle, href, asset => `<style>\n${asset.source}\n</style>`) ?? tag,
        );
        html = html.replace(
          /<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
          (tag, src) => inlineAsset(bundle, src, chunk => `<script type="module">\n${chunk.code}\n</script>`) ?? tag,
        );

        item.source = html;
      }
    },
  };
}
