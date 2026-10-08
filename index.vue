<template>
  <view class="container">
    <view class="header-title">杭电失物招领</view>

    <view class="card-wrap">
      <view class="func-card" @click="goPublish">
        <view class="card-title">发布失物</view>
        <view class="card-desc">发布你的遗失/捡到的物品</view>
      </view>
      <view class="func-card" @click="goFind">
        <view class="card-title">找回</view>
        <view class="card-desc">查看捡到物品、寻回信息</view>
      </view>
    </view>

    <view class="sub-title">📋 近期失物招领</view>
    <view class="list-wrap">
      <view class="item-card" v-for="(item, idx) in itemList" :key="idx" @click="openDetail(item)">
        <view class="item-img">
          <image :src="item.img" mode="aspectFill"></image>
        </view>
        <view class="item-info">
          <view class="name">{{item.name}}</view>
          <view class="desc">{{item.desc}}</view>
          <view class="place-time">📍{{item.place}} | {{item.time}}</view>
          <view>
            <text :class="item.type==='lost'?'tag-lost':'tag-found'">
              {{item.type==='lost'?'寻物':'招领'}}
            </text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      itemList: [
        {
          name: "黑色折叠雨伞",
          desc: "黑色长柄折叠伞，伞柄有划痕",
          place: "图书馆三楼自习区",
          time: "2026-10-01",
          type: "found",
          img: "/static/umbrella.jpg"
        },
        {
          name: "白色保温杯",
          desc: "带茶隔，浅蓝色杯盖",
          place: "食堂一楼",
          time: "2026-10-02",
          type: "lost",
          img: "/static/cup.jpg"
        },
        {
          name: "杭电校园卡",
          desc: "卡面印有校门图片",
          place: "教学楼A座201",
          time: "2026-10-03",
          type: "found",
          img: "/static/card.jpg"
        }
      ]
    }
  },
  methods: {
    goPublish() {
      uni.navigateTo({
        url: "/pages/publish/publish"
      })
    },
    goFind() {
      uni.navigateTo({
		  url:"/pages/list/list"
      })
    },
    openDetail(item) {
      uni.navigateTo({
        url: `/pages/detail/detail?data=${encodeURIComponent(JSON.stringify(item))}`
      })
    }
  }
}
</script>

<style scoped>
.container {
  padding: 40rpx;
  background-color: #f5f7fa;
  min-height: 100vh;
}
.header-title {
  font-size: 48rpx;
  font-weight: bold;
  text-align: center;
  margin: 0 -40rpx 40rpx;
  padding:40rpx;
  background-color:#007aff;
  color:#fff;
}
.card-wrap {
  display:flex;
  flex-direction:column;
  gap:30rpx;
  margin-bottom:40rpx;
}
.func-card {
  background:#fff;
  padding:60rpx 40rpx;
  border-radius:20rpx;
  box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.05);
}
.func-card:active {
  background:#fafafa;
}
.card-title {
  font-size:36rpx;
  font-weight:bold;
  margin-bottom:12rpx;
}
.card-desc {
  font-size:26rpx;
  color:#666;
}
.sub-title {
  font-size:34rpx;
  font-weight:bold;
  margin:20rpx 0;
}
.list-wrap {
  display:flex;
  flex-direction:column;
  gap:20rpx;
}
.item-card {
  background:#fff;
  border-radius:16rpx;
  display:flex;
  padding:20rpx;
  box-shadow:0 2rpx 10rpx rgba(0,0,0,0.06);
}
.item-img {
  width:160rpx;
  height:160rpx;
}
.item-img image {
  width:100%;
  height:100%;
  border-radius:12rpx;
}
.item-info {
  flex:1;
  margin-left:20rpx;
}
.name {
  font-size:32rpx;
  font-weight:bold;
}
.desc {
  font-size:26rpx;
  color:#666;
  margin:8rpx 0;
}
.place-time {
  font-size:24rpx;
  color:#999;
}
.tag-lost {
  font-size:22rpx;
  color:#fff;
  background:#ff6b6b;
  padding:4rpx 12rpx;
  border-radius:20rpx;
}
.tag-found {
  font-size:22rpx;
  color:#fff;
  background:#409eff;
  padding:4rpx 12rpx;
  border-radius:20rpx;
}
</style>