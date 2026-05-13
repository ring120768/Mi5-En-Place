select
  o.opportunity_score,
  s.address_line,
  s.postcode,
  array_agg(distinct sig.type) as signals
from opportunities o
join sites s on s.id = o.site_id
join applications a on a.site_id = s.id
join signals sig on sig.application_id = a.id
group by o.id, s.id
order by o.opportunity_score desc;