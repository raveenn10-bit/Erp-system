'use client';
import {useQuery} from '@tanstack/react-query';
import {api,money} from '@/lib/api';
import {Download,MessageCircle,Printer,X} from 'lucide-react';

type InvoiceDetail={
  invoice:{
    id:string;
    number:string;
    created_at:string;
    shop_name:string;
    address:string;
    whatsapp:string;
    business_name:string;
    business_address:string;
    business_phone:string;
    business_whatsapp?:string;
    business_email?:string;
    total_cents:number;
    paid_cents:number;
    due_at:string|null;
  };
  items:Array<{
    id:string;
    name:string;
    label:string;
    quantity:number;
    unit_price_cents:number;
    line_cents:number;
  }>;
};

export function InvoiceActions({id,close}:{id:string;close:()=>void}){
  const detail=useQuery({queryKey:['invoice',id],queryFn:()=>api<InvoiceDetail>(`/invoices/${id}`)});
  const data=detail.data;

  async function download(){
    if(!data)return;
    const {jsPDF}=await import('jspdf');
    const pdf=new jsPDF();
    const i=data.invoice;
    
    // Header
    pdf.setFontSize(16);
    pdf.setFont('helvetica','bold');
    pdf.text(i.business_name || 'Nugathalawa Ceylon Tea Export (Pvt) Ltd', 15, 20);
    pdf.setFont('helvetica','normal');
    pdf.setFontSize(9);
    pdf.text(i.business_address || 'Na Sewana, Hamangalla, Narangoda, Sri Lanka', 15, 26);
    pdf.text(`Hotline: ${i.business_phone || '076 661 5492'} | Admin / WhatsApp: ${i.business_whatsapp || '076 696 5493'}`, 15, 31);
    if(i.business_email) {
      pdf.text(`Email: ${i.business_email}`, 15, 36);
      pdf.line(15, 40, 195, 40);
    } else {
      pdf.line(15, 35, 195, 35);
    }
    
    const headerY = i.business_email ? 48 : 43;
    pdf.setFontSize(14);
    pdf.setFont('helvetica','bold');
    pdf.text('INVOICE', 15, headerY);
    pdf.setFontSize(9);
    pdf.setFont('helvetica','normal');
    pdf.text(`Invoice No: ${i.number}`, 15, headerY + 7);
    pdf.text(`Date: ${i.created_at.slice(0, 10)}`, 15, headerY + 12);
    pdf.text(`Bill to: ${i.shop_name}`, 15, headerY + 19);
    if (i.address) pdf.text(`Address: ${i.address}`, 15, headerY + 24);
    
    let y = headerY + 35;
    pdf.setFont('helvetica','bold');
    pdf.text('Product / Item', 15, y);
    pdf.text('Qty', 115, y);
    pdf.text('Unit (LKR)', 138, y);
    pdf.text('Total (LKR)', 168, y);
    pdf.line(15, y + 2, 195, y + 2);
    pdf.setFont('helvetica','normal');
    
    for (const line of data.items) {
      y += 8;
      if (y > 270) {
        pdf.addPage();
        y = 20;
      }
      pdf.text(`${line.name} ${line.label}`.slice(0, 45), 15, y);
      pdf.text(String(line.quantity), 115, y);
      pdf.text((line.unit_price_cents / 100).toFixed(2), 138, y);
      pdf.text((line.line_cents / 100).toFixed(2), 168, y);
    }
    
    if (y > 245) {
      pdf.addPage();
      y = 20;
    }
    pdf.line(15, y + 5, 195, y + 5);
    pdf.setFont('helvetica', 'bold');
    pdf.text(`Total: ${money(i.total_cents)}`, 145, y + 14);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Paid: ${money(i.paid_cents)}`, 145, y + 20);
    pdf.text(`Outstanding: ${money(i.total_cents - i.paid_cents)}`, 145, y + 26);
    if (i.due_at) pdf.text(`Due Date: ${i.due_at}`, 145, y + 32);

    pdf.setFontSize(8);
    pdf.text('Thank you for choosing Nugathalawa Tea', 105, 285, { align: 'center' });
    pdf.text('Computer-generated document - no signature required', 105, 289, { align: 'center' });

    pdf.save(`${i.number}.pdf`);
  }

  function share(){
    if(!data)return;
    const i=data.invoice;
    const targetRaw = i.whatsapp || i.business_whatsapp || '0766965493';
    const phone = targetRaw.replace(/\D/g, '').replace(/^0/, '94');
    const message = `*${i.business_name}*\n` +
      `*Invoice:* ${i.number}\n` +
      `*Date:* ${i.created_at.slice(0, 10)}\n` +
      `*Customer:* ${i.shop_name}\n` +
      `*Total:* ${money(i.total_cents)}\n` +
      `*Paid:* ${money(i.paid_cents)}\n` +
      `*Outstanding:* ${money(i.total_cents - i.paid_cents)}\n` +
      (i.due_at ? `*Due Date:* ${i.due_at}\n` : '') +
      `\nHotline: ${i.business_phone || '076 661 5492'}\n` +
      `Admin / WhatsApp: ${i.business_whatsapp || '076 696 5493'}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div className="dialog-card" role="dialog" aria-modal="true" aria-label="Invoice details" onMouseDown={e=>e.stopPropagation()}>
        <div className="panel-head">
          <h3>Invoice details</h3>
          <button className="secondary" aria-label="Close" onClick={close}><X size={18}/></button>
        </div>
        {detail.isLoading ? (
          <div className="loader"/>
        ) : detail.isError ? (
          <div className="error">Could not load invoice.</div>
        ) : data && (
          <>
            <div className="invoice-header" style={{marginBottom: 16, borderBottom: '1px solid #e2e8f0', paddingBottom: 12}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12}}>
                <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
                  <img src="/nugathalawa-logo.jpg" alt="Logo" style={{width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '1px solid #e2e8f0'}} />
                  <div>
                    <h2 style={{fontSize: 20, fontWeight: 700, margin: 0, color: '#0f172a'}}>{data.invoice.business_name}</h2>
                    <p className="muted" style={{margin: '4px 0 2px', fontSize: 13}}>{data.invoice.business_address}</p>
                    <p className="muted" style={{margin: '2px 0', fontSize: 13}}>
                      Hotline: {data.invoice.business_phone || '076 661 5492'} · Admin / WhatsApp: {data.invoice.business_whatsapp || '076 696 5493'}
                      {data.invoice.business_email && ` · Email: ${data.invoice.business_email}`}
                    </p>
                  </div>
                </div>
                <div style={{textAlign: 'right'}}>
                  <span className="eyebrow" style={{display: 'inline-block', background: '#0e927d1a', color: '#0e927d', padding: '3px 8px', borderRadius: 6, fontWeight: 700, fontSize: 12}}>
                    INVOICE
                  </span>
                  <p style={{margin: '4px 0 0', fontWeight: 700, fontSize: 14}}>{data.invoice.number}</p>
                  <p className="muted" style={{margin: 0, fontSize: 12}}>{data.invoice.created_at.slice(0, 10)}</p>
                </div>
              </div>
              <div style={{marginTop: 10, fontSize: 13, background: '#f8fafc', padding: '8px 12px', borderRadius: 8}}>
                <strong>Bill To:</strong> {data.invoice.shop_name} {data.invoice.address ? `· ${data.invoice.address}` : ''}
              </div>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(line=>(
                    <tr key={line.id}>
                      <td>{line.name} · {line.label}</td>
                      <td>{line.quantity}</td>
                      <td>{money(line.unit_price_cents)}</td>
                      <td>{money(line.line_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{textAlign:'right',margin:'20px 0',lineHeight:1.8}}>
              <strong>Total: {money(data.invoice.total_cents)}</strong><br/>
              Paid: {money(data.invoice.paid_cents)}<br/>
              Outstanding: {money(data.invoice.total_cents-data.invoice.paid_cents)}
            </div>

            <div className="form-actions">
              <button className="primary" onClick={download}><Download size={16}/>Download PDF</button>
              <button className="secondary" onClick={()=>window.print()}><Printer size={16}/>Print</button>
              <button className="secondary" onClick={share}><MessageCircle size={16}/>WhatsApp summary</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
