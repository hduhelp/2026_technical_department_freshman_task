<template>
  <view class="container">
    <view class="item-img">
      <image :src="info.img" mode="aspectFill"></image>
    </view>
    <view class="content">
      <view class="name">{{info.name}}</view>
      <view class="tag">
        <text :class="info.type==='lost' ? 'tag-lost' : 'tag-found'">
          {{info.type==='lost' ? '寻物' : '招领'}}
        </text>
      </view>
      <view class="row">
        <text class="label">物品描述：</text>
        <text>{{info.desc}}</text>
      </view>
      <view class="row">
        <text class="label">地点：</text>
        <text>{{info.place}}</text>
      </view>
      <view class="row">
        <text class="label">时间：</text>
        <text>{{info.time}}</text>
      </view>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      info:{}
    }
  },
  onLoad(options) {
    const data = JSON.parse(decodeURIComponent(options.data))
    this.info = data
  }
}
</script>

<style scoped>
.container{
  padding:30rpx;
  background-color: #f5f7fa;
  min-height:100vh;
}
.item-img{
  width:100%;
  height:400rpx;
}
.item-img image{
  width:100%;
  height:100%;
  border-radius:16rpx;
}
.content{
  margin-top:30rpx;
  background:#fff;
  border-radius:16rpx;
  padding:30rpx;
}
.name{
  font-size:36rpx;
  font-weight:bold;
}
.tag{
  margin:15rpx 0;
}
.tag-lost{
  font-size:24rpx;
  color:#fff;
  background:#ff6b6b;
  padding:6rpx 14rpx;
  border-radius: 20rpx;
}
.tag-found{
  font-size:24rpx;
  color:#fff;
  background:#409eff;
  padding:6rpx 14rpx;
  border-radius: 20rpx;
}
.row{
  margin-top:20rpx;
  font-size:28rpx;
}
.label{
  color:#666;
}
</style>