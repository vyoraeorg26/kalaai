const mongoose=require('mongoose');
const orderSchema=new mongoose.Schema({
  orderNumber:{type:String,unique:true},
  customer:{name:String,email:String,phone:String,address:String},
  items:[{productId:Number,name:String,price:Number,quantity:Number,custom:Object}],
  subtotal:Number,
  shippingFee:{type:Number,default:0},
  total:{type:Number,required:true},
  paymentStatus:{type:String,enum:['Pending','Paid','Failed'],default:'Pending'},
  whatsappNotificationStatus:{type:String,enum:['Not configured','Checkout started','Payment confirmed','Customer WhatsApp','Failed'],default:'Not configured'},
  razorpayOrderId:{type:String,index:true,sparse:true},
  razorpayPaymentId:String,
  status:{type:String,enum:['New','Confirmed','In Progress','Shipped','Completed','Cancelled'],default:'New'},
  notes:String
},{timestamps:true});
module.exports=mongoose.model('Order',orderSchema);
