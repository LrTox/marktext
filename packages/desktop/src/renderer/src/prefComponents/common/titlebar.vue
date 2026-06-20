<template>
  <div class="title-bar electron-drag">
    <div
      class="frameless-title-bar-button frameless-title-bar-close electron-no-drag"
      @click.stop="handleCloseClick"
    >
      <div>
        <svg
          width="10"
          height="10"
        >
          <path :d="windowIconClose" />
        </svg>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { closePath as windowIconClose } from '@/assets/window-controls.js'

const handleCloseClick = () => {
  window.electron.windowControl.close()
}
</script>

<style scoped>
.title-bar {
  user-select: none;
  background: transparent;
  height: var(--titleBarHeight);
  box-sizing: border-box;
  color: var(--editorColor50);
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  z-index: 2;
  transition: color 0.4s ease-in-out;
  cursor: default;
}

.frameless-title-bar-button {
  position: absolute;
  display: block;
  top: 0;
  right: 0;
  width: 46px;
  height: var(--titleBarHeight);
}

.frameless-title-bar-button > div {
  position: absolute;
  display: inline-flex;
  top: 50%;
  left: 50%;
  transform: translateX(-50%) translateY(-50%);
}

.frameless-title-bar-close:hover {
  background-color: rgb(228, 79, 79);
}

.frameless-title-bar-button svg {
  fill: #000000;
}

.frameless-title-bar-close:hover svg {
  fill: #ffffff;
}
</style>
