<script setup>
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');

if (typeof window !== 'undefined') {
  window.location.replace(`${base}console/index.html`);
}
</script>

# 正在打开测试控制台

如果页面没有自动跳转，请打开 [测试控制台](./index.html)。
