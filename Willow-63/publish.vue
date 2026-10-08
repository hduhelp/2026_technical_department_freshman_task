<template>
  <view class="container">
    <view class="title">发布失物招领</view>

    <view class="form-item">
      <view class="label">选择类型</view>
      <radio-group @change="onTypeChange">
        <label>
          <radio value="lost" :checked="form.type==='lost'" /> 寻物
        </label>
        <label style="margin-left:40rpx">
          <radio value="found" :checked="form.type==='found'" /> 招领
        </label>
      </radio-group>
    </view>

    <view class="form-item">
      <view class="label">物品名称</view>
      <input placeholder="请输入物品名称" v-model="form.name"/>
    </view>

    <view v-if="form.type === 'lost'">
      <view class="form-item">
        <view class="label">丢失时间</view>
        <picker mode="date" :value="form.lostTime" @change="lostTimeChange">
          <view class="picker">{{form.lostTime || '请选择丢失日期'}}</view>
        </picker>
      </view>
      <view class="form-item">
        <view class="label">丢失地点</view>
        <input placeholder="例如：图书馆三楼" v-model="form.place"/>
      </view>
    </view>

    <view v-if="form.type === 'found'">
      <view class="form-item">
        <view class="label">捡到时间</view>
        <picker mode="date" :value="form.foundTime" @change="foundTimeChange">
          <view class="picker">{{form.foundTime || '请选择捡到日期'}}</view>
        </picker>
      </view>
      <view class="form-item">
        <view class="label">捡到地点</view>
        <input placeholder="例如：食堂一楼" v-model="form.place"/>
      </view>
    </view>

    <view class="form-item">
      <view class="label">物品描述</view>
      <textarea placeholder="描述物品特征" v-model="form.desc"></textarea>
    </view>

    <!-- 图片上传区域 -->
    <view class="form-item">
      <view class="label">上传物品图片</view>
      <view class="img-wrap">
        <!-- 已选图片预览 -->
        <view class="img-item" v-for="(img,idx) in imgList" :key="idx" @click="previewImg(idx)">
          <image :src="img" mode="aspectFill"></image>
          <view class="del-btn" @click.stop="removeImg(idx)">×</view>
        </view>
        <!-- 添加图片按钮 -->
        <view class="add-btn" @click="chooseImg" v-if="imgList.length < 3">
          <text>+</text>
        </view>
      </view>
      <view class="tip">最多上传3张图片</view>
    </view>

    <button class="submit-btn" @click="submitForm">提交发布</button>
  </view>
</template>

<script>
export default {
  data() {
    return {
      form:{
        type:"lost",
        name:"",
        place:"",
        lostTime:"",
        foundTime:"",
        desc:""
      },
      imgList: [] // 存放选中图片的临时路径
    }
  },
  methods:{
    onTypeChange(e){
      this.form.type = e.target.value
    },
    lostTimeChange(e){
      this.form.lostTime = e.target.value
    },
    foundTimeChange(e){
      this.form.foundTime = e.target.value
    },
    // 选择图片
    chooseImg(){
      uni.chooseImage({
        count: 3 - this.imgList.length,
        sizeType:['compressed'],
        sourceType:['album','camera'],
        success: res=>{
          this.imgList = this.imgList.concat(res.tempFilePaths)
        }
      })
    },
    // 删除图片
    removeImg(index){
      this.imgList.splice(index,1)
    },
    // 预览图片
    previewImg(index){
      uni.previewImage({
        urls: this.imgList,
        current: index
      })
    },
    submitForm(){
      console.log("表单数据", this.form)
      console.log("图片临时地址", this.imgList)
      uni.showToast({
        title:"发布成功",
        icon:"success"
      })
    }
  }
}
</script>

<style scoped>
.container{
  padding:40rpx;
  background:#f5f7fa;
  min-height:100vh;
}
.title{
  font-size:36rpx;
  font-weight:bold;
  text-align:center;
  margin-bottom:40rpx;
}
.form-item{
  margin-bottom:30rpx;
}
.label{
  font-size:28rpx;
  margin-bottom:16rpx;
}
input,textarea,.picker{
  border:1rpx solid #ddd;
  padding:20rpx;
  border-radius:12rpx;
  background:#fff;
}
textarea{
  height:160rpx;
}
/* 图片区域样式 */
.img-wrap{
  display:flex;
  gap:20rpx;
  flex-wrap:wrap;
}
.img-item{
  width:160rpx;
  height:160rpx;
  position:relative;
}
.img-item image{
  width:100%;
  height:100%;
  border-radius:12rpx;
}
.del-btn{
  position:absolute;
  top:-10rpx;
  right:-10rpx;
  width:36rpx;
  height:36rpx;
  background:#ff4444;
  color:#fff;
  text-align:center;
  line-height:36rpx;
  border-radius:50%;
}
.add-btn{
  width:160rpx;
  height:160rpx;
  border:1rpx dashed #aaa;
  border-radius:12rpx;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:48rpx;
  color:#aaa;
}
.tip{
  font-size:24rpx;
  color:#999;
  margin-top:12rpx;
}
.submit-btn{
  margin-top:60rpx;
  background:#007aff;
  color:#fff;
}
</style>