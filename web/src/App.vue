<script setup>
import { useRoute } from 'vue-router';

const route = useRoute();

const nav = [
  { to: '/', label: '首页', icon: '🏠' },
  { to: '/trend', label: '趋势分析', icon: '📈' },
  { to: '/exams', label: '历史成绩', icon: '📋' },
  { to: '/analysis', label: '智能分析', icon: '🧠' },
  { to: '/targets', label: '目标院校', icon: '🎯' },
  { to: '/manage', label: '管理', icon: '⚙️' },
];

const bottomNav = [
  { to: '/', label: '首页', icon: '🏠' },
  { to: '/trend', label: '趋势', icon: '📈' },
  { to: '/exams', label: '总览', icon: '📋' },
  { to: '/targets', label: '目标', icon: '🎯' },
  { to: '/analysis', label: '分析', icon: '🧠' },
];

const isActive = (to) => {
  if (to === '/') return route.path === '/';
  if (to === '/manage') return /^\/(manage|entry|settings)/.test(route.path);
  return route.path.startsWith(to);
};
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        孙晗菲的学习记录
      </div>
      <nav>
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item.to) }"
        >
          <span>{{ item.icon }}</span><span>{{ item.label }}</span>
        </RouterLink>
      </nav>
    </aside>

    <div style="flex: 1; min-width: 0">
      <header class="topbar">
        <div class="brand">孙晗菲的学习记录</div>
        <div class="actions">
          <RouterLink to="/manage">⚙️ 管理</RouterLink>
        </div>
      </header>

      <main class="content">
        <RouterView />
      </main>
    </div>

    <nav class="bottom-nav">
      <RouterLink
        v-for="item in bottomNav"
        :key="item.to"
        :to="item.to"
        :class="{ active: isActive(item.to) }"
      >
        <span class="ico">{{ item.icon }}</span>{{ item.label }}
      </RouterLink>
    </nav>
  </div>
</template>
