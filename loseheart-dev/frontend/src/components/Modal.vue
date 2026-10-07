<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
const props = defineProps({ title: String, busy: Boolean })
const emit = defineEmits(['close'])
const dialog = ref(null)
let trigger
onMounted(() => { trigger = document.activeElement; dialog.value.showModal() })
onUnmounted(() => trigger?.focus?.())
</script>
<template><dialog ref="dialog" class="modal" @cancel.prevent="!busy && emit('close')"><header class="row between"><h2>{{ title }}</h2><button class="icon-button" :disabled="busy" aria-label="关闭" @click="emit('close')">×</button></header><slot /></dialog></template>
